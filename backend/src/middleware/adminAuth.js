/**
 * adminAuth — middleware for /api/admin/* routes.
 *
 * v0 model: a single shared admin API key in env, presented via
 * `X-Admin-Api-Key` and compared in constant time. The presenter
 * also passes `X-Admin-Email` so we have an audit trail of who
 * added/changed what — that email is attached to req.admin.
 *
 * Production upgrade path (when you need per-user revocation,
 * roles, or login-from-browser):
 *   - Replace this with JWT issued by a /api/admin/login route
 *     against an AdminUser table (bcrypt-hashed passwords).
 *   - Verify the JWT here and attach req.admin from its claims.
 *   - The route handlers don't need to change — they just keep
 *     reading req.admin.email.
 */

const crypto = require('crypto');

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

if (!ADMIN_API_KEY || ADMIN_API_KEY.length < 32) {
  // Fail loudly at boot rather than ship a weak key by accident.
  throw new Error(
    'ADMIN_API_KEY must be set and at least 32 characters. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

// Precompute the buffer once.
const KEY_BUFFER = Buffer.from(ADMIN_API_KEY, 'utf8');

function adminAuth(req, res, next) {
  const presented = req.header('X-Admin-Api-Key');

  if (!presented || typeof presented !== 'string') {
    return res.status(401).json({ status: false, message: 'Missing admin key' });
  }

  const presentedBuf = Buffer.from(presented, 'utf8');

  // Constant-time compare. timingSafeEqual throws on length mismatch,
  // so we guard that first.
  if (
    presentedBuf.length !== KEY_BUFFER.length ||
    !crypto.timingSafeEqual(presentedBuf, KEY_BUFFER)
  ) {
    return res.status(401).json({ status: false, message: 'Invalid admin key' });
  }

  // Email is optional but recommended for audit. Validate shape if present.
  const email = req.header('X-Admin-Email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ status: false, message: 'Invalid X-Admin-Email' });
  }

  req.admin = { email: email || null };
  next();
}

module.exports = adminAuth;
