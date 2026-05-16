/**
 * Express bootstrap.
 *
 * CRITICAL: the Paystack webhook needs the RAW request body to verify
 * its HMAC signature. We mount express.raw() on the webhook path BEFORE
 * express.json() so the body buffer is preserved for that route only.
 * Every other route uses normal JSON parsing.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paymentRoutes = require('./routes/payment');
const productRoutes = require('./routes/products');
const adminAuth = require('./middleware/adminAuth');
const adminInventoryRoutes = require('./routes/admin/inventory');
const adminModelsRoutes = require('./routes/admin/models');

const app = express();

// --- CORS -----------------------------------------------------------
// Browsers refuse cross-origin requests unless the server opts in. Our
// frontend lives on a different domain (Vercel) than the API (Render),
// so we explicitly allow it. APP_URL is set to the frontend origin in
// production. In dev, allow localhost on common ports.
const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:3000',
  'http://localhost:5173', // Vite default
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / curl / server-to-server (no Origin header).
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: false,
  })
);

// Webhook path must see the raw body. Mounted before any json parser.
app.use(
  '/api/payment/webhook',
  express.raw({ type: 'application/json', limit: '1mb' })
);

// Normal JSON parsing for everything else.
app.use(express.json({ limit: '1mb' }));

// Public routes.
app.use('/api/products', productRoutes);
app.use('/api/payment', paymentRoutes);

// Admin routes — adminAuth gates everything under /api/admin/*.
app.use('/api/admin', adminAuth);
app.use('/api/admin/inventory', adminInventoryRoutes);
app.use('/api/admin/models', adminModelsRoutes);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Fallback error handler — never leak stack traces or secrets.
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ status: false, message: 'Internal error' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);

  // Optional in-process reservation worker. Useful on free-tier hosts
  // (Render Free, etc.) where running a separate worker process would
  // cost an extra instance. Set RUN_WORKER_IN_PROCESS=true to enable.
  // In production you should run the worker as its own process
  // (npm run worker) so the API can scale horizontally without N copies
  // of the sweeper running in parallel.
  if (process.env.RUN_WORKER_IN_PROCESS === 'true') {
    const { start } = require('./workers/release-reservations');
    start();
  }
});
