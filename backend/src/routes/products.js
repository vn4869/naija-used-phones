/**
 * Public product listing — /api/products
 *
 * No auth required. Returns AVAILABLE devices grouped lightly so the
 * storefront can render product cards. Each device unit is its own
 * row (because the marketplace is "one device, one condition") but
 * we include the parent ProductModel for display.
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

// GET /api/products — list AVAILABLE devices
router.get('/', async (req, res) => {
  try {
    const units = await prisma.deviceUnit.findMany({
      where: { status: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: {
        productModel: {
          select: {
            name: true,
            colorway: true,
            storageGb: true,
            heroImageRef: true,
            brand: { select: { name: true } },
          },
        },
      },
    });

    return res.json({
      status: true,
      data: units.map((u) => ({
        id: u.id,
        sku: u.sku,
        cosmeticGrade: u.cosmeticGrade,
        batteryHealthPct: u.batteryHealthPct,
        priceKobo: u.priceKobo?.toString() ?? null,
        priceNgn:
          u.priceKobo != null ? (u.priceKobo / 100n).toString() : null,
        galleryImageRefs: u.galleryImageRefs,
        productModel: u.productModel,
      })),
    });
  } catch (err) {
    console.error('[GET /api/products]', err);
    return res
      .status(500)
      .json({ status: false, message: 'Could not load products' });
  }
});

module.exports = router;
