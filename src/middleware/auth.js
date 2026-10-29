import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { sendError } from '../utils/response.js';

const expected = Buffer.from(env.ADMIN_API_KEY);

/**
 * Administrative operations require the `x-api-key` header to match ADMIN_API_KEY
 * (constant-time comparison). This is a single shared key appropriate for a single-tenant
 * challenge deployment; production would use per-user identity (OIDC/JWT) and roles.
 */
export function requireAdminKey(req, res, next) {
  const provided = Buffer.from(String(req.get('x-api-key') ?? ''));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return sendError(
      res,
      401,
      'UNAUTHORIZED',
      'A valid x-api-key header is required for admin operations',
    );
  }
  return next();
}
