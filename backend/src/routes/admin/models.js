/**
 * Admin product-model routes — /api/admin/models
 *
 *   GET /  list ProductModels (with brand info) for dropdowns.
 *
 * Gated by adminAuth at the app level.
 */

const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const items = await prisma.productModel.findMany({
      orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }, { storageGb: 'asc' }],
      include: {
        brand: { select: { name: true, slug: true } },
      },
    });

    return res.json({
      status: true,
      data: {
        items: items.map((m) => ({
          id: m.id,
          slug: m.slug,
          name: m.name,
          colorway: m.colorway,
          storageGb: m.storageGb,
          releaseYear: m.releaseYear,
          heroImageRef: m.heroImageRef,
          brand: m.brand,
        })),
      },
    });
  } catch (err) {
    console.error('[admin/models GET] error', err);
    return res
      .status(500)
      .json({ status: false, message: 'Could not list models' });
  }
});

module.exports = router;
