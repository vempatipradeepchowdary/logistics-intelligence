import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../utils/response.js';

export function notFoundHandler(req, res) {
  return sendError(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} does not exist`);
}

/** Centralised error middleware. Never leaks stack traces or internal configuration. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500)
      logger.error('request.error', { requestId: req.id, code: err.code, err });
    return sendError(res, err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'The request contains invalid fields',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof mongoose.Error.CastError || err instanceof mongoose.Error.ValidationError) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The request contains invalid values');
  }
  if (err?.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (err?.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit');
  }
  logger.error('request.unhandled', { requestId: req.id, path: req.path, err });
  return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
