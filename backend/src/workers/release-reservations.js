/**
 * Reservation-release worker.
 *
 * Runs in its own process. Every RELEASE_INTERVAL_MS it sweeps for
 * devices where:
 *     status        = 'RESERVED'
 *     reservedUntil < now()
 *
 * Those reservations are abandoned checkouts. We:
 *   1. Cancel any PENDING order that holds the reservation.
 *   2. Flip the device back to AVAILABLE (clearing reservedUntil and
 *      reservedByOrderId) — but ONLY if it's still RESERVED. The
 *      conditional update is the safety net against the obvious race:
 *      a webhook arriving between our SELECT and our UPDATE.
 *
 * Running this as a separate process means the API can scale
 * horizontally without spawning N parallel sweepers. In dev you can
 * also `require('./workers/release-reservations').start()` from
 * server.js if you'd rather one-process everything.
 *
 * Run:
 *   node src/workers/release-reservations.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const RELEASE_INTERVAL_MS = Number(
  process.env.RELEASE_INTERVAL_MS || 60_000 // sweep once per minute
);

// Grace period beyond reservedUntil before we reclaim. This protects
// against the worker stealing a device from a charge that's mid-flight:
// the customer hit "Pay" at T+14:59, Paystack is processing, the
// webhook hasn't landed yet. Waiting an extra 60s gives Paystack
// plenty of room to deliver charge.success before we reclaim.
const RECLAIM_GRACE_MS = Number(process.env.RECLAIM_GRACE_MS || 60_000);

let isRunning = false; // re-entrancy guard

async function sweepOnce() {
  // Prevent overlap if a sweep takes longer than the interval.
  if (isRunning) return;
  isRunning = true;

  try {
    const cutoff = new Date(Date.now() - RECLAIM_GRACE_MS);

    // Pull expired reservations in one shot. We only need ids.
    const expired = await prisma.deviceUnit.findMany({
      where: {
        status: 'RESERVED',
        reservedUntil: { lt: cutoff },
      },
      select: {
        id: true,
        sku: true,
        imei: true,
        reservedByOrderId: true,
      },
      take: 200, // cap per sweep — large backlogs catch up over a few sweeps
    });

    if (expired.length === 0) return;

    let released = 0;

    for (const unit of expired) {
      try {
        await prisma.$transaction(async (tx) => {
          // 1. Cancel a dangling PENDING order (if any). We only
          //    cancel if it's still PENDING — a webhook that arrived
          //    in the meantime will have moved it to PAID/FAILED.
          if (unit.reservedByOrderId) {
            await tx.order.updateMany({
              where: {
                id: unit.reservedByOrderId,
                status: 'PENDING',
              },
              data: { status: 'CANCELLED' },
            });
          }

          // 2. Atomic release: only succeeds if the device is still
          //    RESERVED with an expired window. A webhook that just
          //    landed and flipped this to SOLD will fall through
          //    here harmlessly (count === 0).
          const result = await tx.deviceUnit.updateMany({
            where: {
              id: unit.id,
              status: 'RESERVED',
              reservedUntil: { lt: cutoff },
            },
            data: {
              status: 'AVAILABLE',
              reservedUntil: null,
              reservedByOrderId: null,
            },
          });

          if (result.count === 1) released++;
        });
      } catch (err) {
        console.error(
          `[release-worker] failed to release device ${unit.id} (${unit.sku})`,
          err
        );
      }
    }

    if (released > 0) {
      console.log(
        `[release-worker] released ${released}/${expired.length} expired reservations`
      );
    }
  } catch (err) {
    console.error('[release-worker] sweep failed', err);
  } finally {
    isRunning = false;
  }
}

function start() {
  console.log(
    `[release-worker] starting — sweeping every ${RELEASE_INTERVAL_MS}ms`
  );
  // Kick off immediately, then on an interval.
  sweepOnce();
  const handle = setInterval(sweepOnce, RELEASE_INTERVAL_MS);

  // Graceful shutdown so in-flight transactions finish.
  const shutdown = async (signal) => {
    console.log(`[release-worker] ${signal} received, shutting down`);
    clearInterval(handle);
    // Wait for any in-flight sweep to finish (best-effort).
    for (let i = 0; i < 30 && isRunning; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Allow both standalone execution and programmatic import.
if (require.main === module) {
  start();
}

module.exports = { start, sweepOnce };
