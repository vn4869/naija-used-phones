/**
 * Payment routes — Paystack integration for the marketplace.
 *
 *   POST /api/payment/initialize   Reserves a device + opens a Paystack session.
 *   POST /api/payment/webhook      Verifies + processes Paystack events.
 *
 * Security & correctness highlights:
 *   - All money is stored as BigInt; we convert NGN → kobo at the
 *     Paystack boundary only.
 *   - Device reservation is an atomic conditional UPDATE: the only way
 *     to win the race is for the database to see status = AVAILABLE.
 *   - Webhook signature is verified over the RAW request body using
 *     HMAC-SHA512 with a timing-safe compare.
 *   - Each Paystack event id is recorded once — retried deliveries are
 *     no-ops.
 *   - We never trust the webhook's amount field; we compare it against
 *     the amount we stored on the Order.
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE = 'https://api.paystack.co';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const RESERVATION_MINUTES = 15;

if (!PAYSTACK_SECRET_KEY) {
  throw new Error('PAYSTACK_SECRET_KEY is required in the environment');
}

// =====================================================================
// POST /api/payment/initialize
// ---------------------------------------------------------------------
// Body: { customerEmail, customerName, customerPhone?, deviceUnitId }
//
// Flow:
//   1. Upsert customer.
//   2. Atomically reserve the device (DB-level guard against double-sell).
//   3. Create Order with a unique reference (also our idempotency key).
//   4. Call Paystack /transaction/initialize with channels [card,
//      bank_transfer, ussd] and the amount converted to kobo.
//   5. Return the authorization_url to the frontend.
// =====================================================================
router.post('/initialize', express.json(), async (req, res) => {
  const { customerEmail, customerName, customerPhone, deviceUnitId } = req.body || {};

  if (!customerEmail || !customerName || !deviceUnitId) {
    return res.status(400).json({
      status: false,
      message: 'customerEmail, customerName, and deviceUnitId are required',
    });
  }

  try {
    // ---- 1. Customer (idempotent on email) --------------------------
    const customer = await prisma.customer.upsert({
      where: { email: customerEmail.toLowerCase() },
      update: {
        fullName: customerName,
        phone: customerPhone ?? undefined,
      },
      create: {
        email: customerEmail.toLowerCase(),
        fullName: customerName,
        phone: customerPhone ?? null,
      },
    });

    // ---- 2 + 3. Reserve device and create order atomically ----------
    const reference = `ord_${crypto.randomBytes(10).toString('hex')}`;
    const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000);

    const { order, deviceUnit } = await prisma.$transaction(async (tx) => {
      // Conditional update: only succeeds if the device is still
      // AVAILABLE. If another checkout beat us to it, count === 0 and
      // we abort the transaction with a friendly error.
      const reserveResult = await tx.deviceUnit.updateMany({
        where: { id: deviceUnitId, status: 'AVAILABLE' },
        data: {
          status: 'RESERVED',
          reservedUntil,
        },
      });

      if (reserveResult.count === 0) {
        const err = new Error('DEVICE_NOT_AVAILABLE');
        err.code = 'DEVICE_NOT_AVAILABLE';
        throw err;
      }

      const device = await tx.deviceUnit.findUnique({
        where: { id: deviceUnitId },
      });

      const order = await tx.order.create({
        data: {
          reference,
          customerId: customer.id,
          deviceUnitId: device.id,
          // priceKobo is already in Paystack's native unit. amountNgn
          // is denormalised for display only.
          amountKobo: device.priceKobo,
          amountNgn: device.priceKobo / 100n,
          status: 'PENDING',
        },
      });

      // Link the reservation to this order so the webhook can verify
      // that the device was reserved by *this* checkout, not another.
      await tx.deviceUnit.update({
        where: { id: device.id },
        data: { reservedByOrderId: order.id },
      });

      return { order, deviceUnit: device };
    });

    // ---- 4. Initialize the Paystack transaction ---------------------
    const paystackResp = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email: customer.email,
        // Paystack expects an integer kobo amount.
        amount: Number(order.amountKobo),
        reference: order.reference,
        currency: 'NGN',
        // Nigeria-specific channels so users see card, bank transfer,
        // and USSD on the Paystack checkout page.
        channels: ['card', 'bank_transfer', 'ussd'],
        callback_url: `${APP_URL}/checkout/verify?ref=${order.reference}`,
        metadata: {
          orderId: order.id,
          deviceUnitId: deviceUnit.id,
          imei: deviceUnit.imei,
          sku: deviceUnit.sku,
          customerName: customer.fullName,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      }
    );

    const { access_code, authorization_url } = paystackResp.data.data;

    // ---- 5. Persist Paystack handles on the order for later lookup --
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paystackAccessCode: access_code,
        paystackAuthUrl: authorization_url,
      },
    });

    return res.json({
      status: true,
      message: 'Payment initialized',
      data: {
        reference: order.reference,
        authorization_url,
        access_code,
        reservedUntil,
      },
    });
  } catch (err) {
    if (err?.code === 'DEVICE_NOT_AVAILABLE') {
      return res.status(409).json({
        status: false,
        message:
          'This device has just been reserved or sold. Please pick another unit.',
      });
    }

    // Paystack errors surface in err.response.data — log them but
    // never leak the secret-key-bearing request to the client.
    console.error(
      '[payment/initialize] failure',
      err?.response?.data || err.message
    );
    return res.status(500).json({
      status: false,
      message: 'Could not initialize payment. Please try again.',
    });
  }
});

// =====================================================================
// POST /api/payment/webhook
// ---------------------------------------------------------------------
// Verifies Paystack's HMAC-SHA512 signature over the raw request body,
// then dispatches the event. On `charge.success` we atomically flip the
// device from RESERVED → SOLD only if the reservation belongs to this
// order — making double-selling impossible under any race.
//
// NB: This route is mounted with express.raw() in server.js so
//     req.body arrives as a Buffer (required for HMAC).
// =====================================================================
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];

  if (!signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).end();
  }

  // ---- 1. Verify HMAC over the raw payload ------------------------
  const expected = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(req.body)
    .digest('hex');

  let signatureOk = false;
  try {
    // timingSafeEqual throws if the buffers differ in length; wrap it.
    signatureOk = crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    signatureOk = false;
  }

  if (!signatureOk) {
    console.warn('[paystack webhook] signature mismatch — rejected');
    return res.status(401).end();
  }

  // ---- 2. Parse the verified payload -----------------------------
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    console.error('[paystack webhook] invalid JSON after verified HMAC', err);
    return res.status(400).end();
  }

  const { event: eventType, data } = event;
  if (!eventType || !data) return res.status(400).end();

  // ---- 3. Process inside a single transaction that ALSO records the
  //         event. This guarantees:
  //           - the event-record write and the side-effects commit together
  //             (no "marked processed but didn't happen" state),
  //           - the WebhookEvent unique constraint catches duplicate
  //             deliveries even under concurrent retries.
  //         If processing fails we return 500 so Paystack retries;
  //         a successful retry will find the event already recorded
  //         and short-circuit.
  try {
    await prisma.$transaction(async (tx) => {
      // Insert the event row first. P2002 here means this Paystack
      // event id has already been processed — short-circuit cleanly.
      try {
        await tx.webhookEvent.create({
          data: {
            paystackId: String(data.id),
            eventType,
            reference: data.reference ?? null,
            payload: event,
          },
        });
      } catch (err) {
        if (err?.code === 'P2002') {
          // Re-throw a sentinel so the outer catch can 200 without
          // doing anything else.
          const dup = new Error('DUPLICATE_EVENT');
          dup.code = 'DUPLICATE_EVENT';
          throw dup;
        }
        throw err;
      }

      switch (eventType) {
        case 'charge.success':
          await applyChargeSuccess(tx, data);
          break;
        case 'charge.failed':
          await applyChargeFailed(tx, data);
          break;
        // Add more handlers (refund, transfer.*) as the product grows.
        // Default: event is recorded for audit, no side effects.
      }
    });

    return res.status(200).end();
  } catch (err) {
    if (err?.code === 'DUPLICATE_EVENT') {
      console.log(`[paystack webhook] duplicate event ${data.id}, ignored`);
      return res.status(200).end();
    }
    console.error('[paystack webhook] processing failed', err);
    // 500 → Paystack retries. Idempotency makes that safe.
    return res.status(500).end();
  }
});

/**
 * Apply charge.success inside the caller's transaction.
 *
 * Marks the order PAID and the device SOLD — atomically, and only if
 * the device is still RESERVED by this exact order. This conditional
 * UPDATE is what makes double-selling impossible: if anything else
 * (manual admin action, parallel webhook, expired reservation) already
 * changed the device, count === 0 and we abort the whole transaction.
 *
 * `tx` is a Prisma transaction client passed in by the webhook handler
 * so that this work commits together with the WebhookEvent insert.
 */
async function applyChargeSuccess(tx, data) {
  const reference = data.reference;

  const order = await tx.order.findUnique({
    where: { reference },
    include: { deviceUnit: true },
  });

  if (!order) {
    console.warn(`[charge.success] no order for reference ${reference}`);
    return;
  }

  // Defense-in-depth: the idempotency row already prevents re-entry,
  // but a paid order should never be re-paid even if state got out of sync.
  if (order.status === 'PAID') return;

  // Never trust the webhook to tell us the amount. Compare against
  // what we recorded at checkout.
  const paidKobo = BigInt(data.amount);
  if (paidKobo !== order.amountKobo) {
    console.error(
      `[charge.success] amount mismatch on ${reference}: ` +
        `expected ${order.amountKobo} kobo, got ${paidKobo} kobo. ` +
        `Order flagged — manual review required.`
    );
    // Don't mark sold. Record the payment row so finance can investigate.
    await tx.payment.create({
      data: {
        orderId: order.id,
        reference,
        amountKobo: paidKobo,
        channel: data.channel ?? null,
        status: 'amount_mismatch',
        paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
        rawResponse: data,
      },
    });
    return;
  }

  // The critical atomic flip. Only succeeds if the device is still
  // RESERVED by this exact order.
  const flip = await tx.deviceUnit.updateMany({
    where: {
      id: order.deviceUnitId,
      status: 'RESERVED',
      reservedByOrderId: order.id,
    },
    data: {
      status: 'SOLD',
      reservedUntil: null,
    },
  });

  if (flip.count === 0) {
    // Reservation expired or was overridden. Don't auto-sell.
    // Throwing rolls the whole transaction back, including the
    // WebhookEvent row — Paystack will retry, and a human can step in.
    console.error(
      `[charge.success] could not flip device ${order.deviceUnitId} ` +
        `to SOLD — no longer RESERVED for order ${order.id}. ` +
        `Likely cause: reservation expired before payment cleared.`
    );
    throw new Error('DEVICE_NOT_RESERVED_FOR_ORDER');
  }

  await tx.order.update({
    where: { id: order.id },
    data: { status: 'PAID', paidAt: new Date() },
  });

  await tx.payment.create({
    data: {
      orderId: order.id,
      reference,
      amountKobo: paidKobo,
      channel: data.channel ?? null,
      status: 'success',
      paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
      rawResponse: data,
    },
  });

  console.log(`[charge.success] ${reference} → order PAID, device SOLD`);
}

/** Apply charge.failed: release the reservation so the device is buyable again. */
async function applyChargeFailed(tx, data) {
  const reference = data.reference;
  const order = await tx.order.findUnique({ where: { reference } });
  if (!order || order.status !== 'PENDING') return;

  await tx.order.update({
    where: { id: order.id },
    data: { status: 'FAILED' },
  });

  // Release the reservation so the device can be sold to someone else.
  await tx.deviceUnit.updateMany({
    where: { id: order.deviceUnitId, reservedByOrderId: order.id },
    data: {
      status: 'AVAILABLE',
      reservedUntil: null,
      reservedByOrderId: null,
    },
  });

  await tx.payment.create({
    data: {
      orderId: order.id,
      reference,
      amountKobo: BigInt(data.amount ?? 0),
      channel: data.channel ?? null,
      status: 'failed',
      rawResponse: data,
    },
  });

  console.log(`[charge.failed] ${reference} → reservation released`);
}

// =====================================================================
// POST /api/payment/verify
// ---------------------------------------------------------------------
// Body: { reference }
//
// Called by the frontend after Paystack redirects the user back to
// /checkout/verify?ref=... . Acts as a fast, authoritative confirmation
// alongside the asynchronous webhook.
//
// Idempotency vs. the webhook is handled cleanly: Paystack's verify
// response and webhook event both expose the SAME transaction id, and
// we use String(data.id) as the WebhookEvent key in both code paths.
// Whichever races to commit first wins; the other gets P2002 on the
// WebhookEvent insert, short-circuits, and the order ends up PAID
// either way.
// =====================================================================
router.post('/verify', express.json(), async (req, res) => {
  const { reference } = req.body || {};
  if (!reference || typeof reference !== 'string') {
    return res
      .status(400)
      .json({ status: false, message: 'reference is required' });
  }

  try {
    // ---- 1. Fast path: order already settled in our DB ------------
    const cached = await prisma.order.findUnique({
      where: { reference },
      include: { deviceUnit: { select: { sku: true, imei: true } } },
    });

    if (!cached) {
      return res
        .status(404)
        .json({ status: false, message: 'Order not found' });
    }

    if (cached.status === 'PAID') {
      return res.json({
        status: true,
        message: 'Payment confirmed',
        data: serializeOrder(cached),
      });
    }

    // ---- 2. Ask Paystack the source of truth ----------------------
    const paystackResp = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
        timeout: 15_000,
      }
    );

    const tx = paystackResp.data?.data;
    if (!tx) {
      return res
        .status(502)
        .json({ status: false, message: 'Unexpected Paystack response' });
    }

    // ---- 3. Map Paystack status to our domain --------------------
    // tx.status values we care about: 'success', 'failed', 'abandoned',
    // 'pending', 'reversed'.
    if (tx.status === 'pending') {
      // Paystack hasn't finalised yet. Tell the client to poll.
      return res.json({
        status: false,
        pending: true,
        message: 'Payment still pending — try again shortly',
        data: serializeOrder(cached),
      });
    }

    if (tx.status !== 'success') {
      // Failed / abandoned / reversed — release the reservation if
      // it's still held, mirror the webhook's failed-charge behavior.
      await prisma.$transaction(async (t) => {
        const fresh = await t.order.findUnique({ where: { reference } });
        if (!fresh || fresh.status !== 'PENDING') return;
        await t.order.update({
          where: { id: fresh.id },
          data: { status: 'FAILED' },
        });
        await t.deviceUnit.updateMany({
          where: { id: fresh.deviceUnitId, reservedByOrderId: fresh.id },
          data: {
            status: 'AVAILABLE',
            reservedUntil: null,
            reservedByOrderId: null,
          },
        });
      });

      const after = await prisma.order.findUnique({
        where: { reference },
        include: { deviceUnit: { select: { sku: true, imei: true } } },
      });

      return res.json({
        status: false,
        message: `Payment ${tx.status}`,
        data: serializeOrder(after),
      });
    }

    // ---- 4. Paystack says success — apply the same flip the      --
    //         webhook would. Shared idempotency key ensures no      --
    //         double-processing.                                    --
    try {
      await prisma.$transaction(async (t) => {
        try {
          await t.webhookEvent.create({
            data: {
              paystackId: String(tx.id),
              eventType: 'verify.success',
              reference,
              payload: tx,
            },
          });
        } catch (err) {
          if (err?.code === 'P2002') {
            // Webhook already processed this exact transaction id.
            // Nothing to do — the order should already be PAID.
            const dup = new Error('DUPLICATE_EVENT');
            dup.code = 'DUPLICATE_EVENT';
            throw dup;
          }
          throw err;
        }
        await applyChargeSuccess(t, tx);
      });
    } catch (err) {
      if (err?.code !== 'DUPLICATE_EVENT') throw err;
      // Fall through — re-read state below.
    }

    // ---- 5. Return current order state ---------------------------
    const after = await prisma.order.findUnique({
      where: { reference },
      include: { deviceUnit: { select: { sku: true, imei: true } } },
    });

    return res.json({
      status: after?.status === 'PAID',
      message:
        after?.status === 'PAID'
          ? 'Payment confirmed'
          : 'Payment received but order not finalised — please contact support',
      data: serializeOrder(after),
    });
  } catch (err) {
    console.error(
      '[payment/verify] failure',
      err?.response?.data || err.message
    );
    return res
      .status(500)
      .json({ status: false, message: 'Could not verify payment' });
  }
});

/**
 * Convert Prisma's BigInt-bearing order shape to a JSON-safe payload.
 * Frontend gets amounts as strings — keeps precision intact for prices
 * that could exceed Number.MAX_SAFE_INTEGER in kobo.
 */
function serializeOrder(order) {
  if (!order) return null;
  return {
    reference: order.reference,
    status: order.status,
    amountNgn: order.amountNgn?.toString() ?? null,
    amountKobo: order.amountKobo?.toString() ?? null,
    paidAt: order.paidAt,
    deviceUnit: order.deviceUnit ?? null,
  };
}

module.exports = router;
