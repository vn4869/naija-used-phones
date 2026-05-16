/**
 * Admin inventory routes — /api/admin/inventory
 *
 *   POST /         add a new device unit to inventory
 *   GET  /         list inventory with filters + pagination
 *
 * All routes are gated by the adminAuth middleware (see server.js).
 * Validation runs server-side regardless of frontend checks: never
 * trust the dashboard.
 */

const express = require('express');
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

const COSMETIC_GRADES = [
  'BRAND_NEW',
  'LIKE_NEW',
  'EXCELLENT',
  'GOOD',
  'FAIR',
];

const ALLOWED_INITIAL_STATUS = ['IN_INSPECTION', 'AVAILABLE'];

const ALLOWED_STATUS_FILTERS = [
  'IN_INSPECTION',
  'AVAILABLE',
  'RESERVED',
  'SOLD',
  'RETURNED',
  'RETIRED',
];

// =====================================================================
// POST /api/admin/inventory
// ---------------------------------------------------------------------
// Body:
//   {
//     productModelId:    string,            // existing ProductModel.id
//     imei:              string,            // 14–15 digits (IMEI / IMEISV)
//     serialNumber?:     string,
//     cosmeticGrade:     CosmeticGrade,
//     batteryHealthPct:  number 0–100,
//     priceKobo:         string | number,   // kobo, BigInt-safe as string
//     notes?:            string,
//     galleryImageRefs?: string[],
//     status?:           'IN_INSPECTION' | 'AVAILABLE'  // default IN_INSPECTION
//   }
//
// Server generates the SKU (`<model-slug>-XXXXXX`).
// =====================================================================
router.post('/', async (req, res) => {
  const body = req.body || {};

  // ---- Validate ---------------------------------------------------
  const errors = [];

  if (!body.productModelId || typeof body.productModelId !== 'string') {
    errors.push('productModelId is required');
  }

  // IMEI: 14 or 15 digits. We don't enforce the Luhn check here —
  // do that in a follow-up route if needed.
  if (!body.imei || !/^\d{14,15}$/.test(body.imei)) {
    errors.push('imei must be 14 or 15 digits');
  }

  if (body.serialNumber != null && typeof body.serialNumber !== 'string') {
    errors.push('serialNumber must be a string if provided');
  }

  if (!COSMETIC_GRADES.includes(body.cosmeticGrade)) {
    errors.push(
      `cosmeticGrade must be one of: ${COSMETIC_GRADES.join(', ')}`
    );
  }

  const battery = Number(body.batteryHealthPct);
  if (!Number.isInteger(battery) || battery < 0 || battery > 100) {
    errors.push('batteryHealthPct must be an integer between 0 and 100');
  }

  // priceKobo: accept string or number, coerce to BigInt, must be positive.
  let priceKobo;
  try {
    priceKobo = BigInt(body.priceKobo);
    if (priceKobo <= 0n) throw new Error('non-positive');
  } catch {
    errors.push('priceKobo must be a positive integer (in kobo)');
  }

  const status = body.status ?? 'IN_INSPECTION';
  if (!ALLOWED_INITIAL_STATUS.includes(status)) {
    errors.push(
      `status (if provided) must be one of: ${ALLOWED_INITIAL_STATUS.join(', ')}`
    );
  }

  if (
    body.galleryImageRefs != null &&
    (!Array.isArray(body.galleryImageRefs) ||
      body.galleryImageRefs.some((r) => typeof r !== 'string'))
  ) {
    errors.push('galleryImageRefs must be an array of strings');
  }

  if (errors.length) {
    return res.status(400).json({ status: false, errors });
  }

  // ---- Look up the model to build a readable SKU prefix -----------
  const model = await prisma.productModel.findUnique({
    where: { id: body.productModelId },
    select: { id: true, slug: true, name: true },
  });

  if (!model) {
    return res
      .status(400)
      .json({ status: false, message: 'productModelId not found' });
  }

  // SKU = first 16 chars of slug + 6 random hex. Collision-improbable
  // and the UNIQUE constraint on sku catches the rest.
  const sku =
    `${model.slug.slice(0, 16).toUpperCase()}-` +
    crypto.randomBytes(3).toString('hex').toUpperCase();

  // ---- Insert -----------------------------------------------------
  try {
    const created = await prisma.deviceUnit.create({
      data: {
        sku,
        imei: body.imei,
        serialNumber: body.serialNumber || null,
        productModelId: model.id,
        cosmeticGrade: body.cosmeticGrade,
        batteryHealthPct: battery,
        priceKobo,
        status,
        notes: body.notes || null,
        galleryImageRefs: body.galleryImageRefs || [],
        addedByEmail: req.admin?.email || null,
      },
      include: {
        productModel: {
          select: { name: true, colorway: true, storageGb: true },
        },
      },
    });

    return res.status(201).json({
      status: true,
      message: 'Device added',
      data: serializeUnit(created),
    });
  } catch (err) {
    // Unique constraint violation — almost always a duplicate IMEI
    // (occasionally serial). This is the "One Device, One Condition"
    // rule biting attempts to re-list a phone we already have.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = err.meta?.target;
      const field = Array.isArray(target) ? target.join(',') : String(target);
      return res.status(409).json({
        status: false,
        message: `A device with this ${field || 'identifier'} is already in inventory`,
      });
    }
    console.error('[admin/inventory POST] error', err);
    return res
      .status(500)
      .json({ status: false, message: 'Could not add device' });
  }
});

// =====================================================================
// GET /api/admin/inventory
// ---------------------------------------------------------------------
// Query params (all optional):
//   status     comma-separated list, e.g. "AVAILABLE,RESERVED"
//   grade      cosmetic grade filter
//   modelId    filter by ProductModel.id
//   q          search across SKU, IMEI, serialNumber (contains)
//   page       1-based page number (default 1)
//   pageSize   default 25, max 100
//   includeCounts  "1" to also return aggregate counts by status
// =====================================================================
router.get('/', async (req, res) => {
  const pageSize = Math.min(
    Math.max(parseInt(req.query.pageSize, 10) || 25, 1),
    100
  );
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const where = {};

  if (req.query.status) {
    const requested = String(req.query.status)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ALLOWED_STATUS_FILTERS.includes(s));
    if (requested.length) where.status = { in: requested };
  }

  if (req.query.grade) {
    const g = String(req.query.grade).toUpperCase();
    if (COSMETIC_GRADES.includes(g)) where.cosmeticGrade = g;
  }

  if (req.query.modelId) {
    where.productModelId = String(req.query.modelId);
  }

  if (req.query.q) {
    const q = String(req.query.q).trim();
    if (q) {
      // Prisma generates parameterised SQL so this is safe from injection.
      where.OR = [
        { sku: { contains: q, mode: 'insensitive' } },
        { imei: { contains: q } },
        { serialNumber: { contains: q } },
      ];
    }
  }

  try {
    const [total, units] = await Promise.all([
      prisma.deviceUnit.count({ where }),
      prisma.deviceUnit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          productModel: {
            select: { name: true, colorway: true, storageGb: true },
          },
        },
      }),
    ]);

    let counts = null;
    if (req.query.includeCounts === '1') {
      const grouped = await prisma.deviceUnit.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      counts = Object.fromEntries(
        ALLOWED_STATUS_FILTERS.map((s) => [s, 0])
      );
      for (const g of grouped) counts[g.status] = g._count._all;
    }

    return res.json({
      status: true,
      data: {
        items: units.map(serializeUnit),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        counts,
      },
    });
  } catch (err) {
    console.error('[admin/inventory GET] error', err);
    return res
      .status(500)
      .json({ status: false, message: 'Could not list inventory' });
  }
});

/** BigInt-safe shape for the wire. */
function serializeUnit(u) {
  return {
    id: u.id,
    sku: u.sku,
    imei: u.imei,
    serialNumber: u.serialNumber,
    cosmeticGrade: u.cosmeticGrade,
    batteryHealthPct: u.batteryHealthPct,
    status: u.status,
    priceKobo: u.priceKobo?.toString() ?? null,
    priceNgn:
      u.priceKobo != null ? (u.priceKobo / 100n).toString() : null,
    notes: u.notes,
    galleryImageRefs: u.galleryImageRefs,
    reservedUntil: u.reservedUntil,
    addedByEmail: u.addedByEmail,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    productModel: u.productModel ?? null,
  };
}

module.exports = router;
