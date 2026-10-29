import { z } from 'zod';

/**
 * Validate and coerce request parts with Zod. Parsed values are exposed on `req.valid`
 * (Express 5 makes `req.query` read-only). Unknown query/body keys are rejected (strict).
 */
export function validateRequest({ params, query, body } = {}) {
  return (req, _res, next) => {
    req.valid = {
      params: params ? params.parse(req.params) : req.params,
      query: query ? query.parse(req.query ?? {}) : {},
      body: body ? body.parse(req.body ?? {}) : {},
    };
    next();
  };
}

export const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));
