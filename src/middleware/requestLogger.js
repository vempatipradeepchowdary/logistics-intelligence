import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

/** Assigns a request ID (echoed as x-request-id) and logs one structured line per request. */
export function requestLogger(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[A-Za-z0-9-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  res.set('x-request-id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info('http.request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
    });
  });
  next();
}
