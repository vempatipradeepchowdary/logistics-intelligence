import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import * as controller from '../controllers/admin.controller.js';
import {
  exportBody,
  generateBody,
  jobIdParams,
  jobsQuery,
  validateBody,
} from '../controllers/schemas.js';
import { requireAdminKey } from '../middleware/auth.js';
import { validateRequest } from '../middleware/requestValidator.js';
import { sendError } from '../utils/response.js';

export const adminRouter = Router();

// Strict limit for expensive mutating operations only; status polling uses the global API limit.
const mutationLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.ADMIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many admin requests; slow down'),
});

adminRouter.use(requireAdminKey);

adminRouter.post(
  '/generate',
  mutationLimiter,
  validateRequest({ body: generateBody }),
  controller.generate,
);
adminRouter.post(
  '/validate',
  mutationLimiter,
  validateRequest({ body: validateBody }),
  controller.validate,
);
adminRouter.post(
  '/export',
  mutationLimiter,
  validateRequest({ body: exportBody }),
  controller.exportData,
);
adminRouter.get('/jobs', validateRequest({ query: jobsQuery }), controller.jobs);
adminRouter.get('/jobs/:jobId', validateRequest({ params: jobIdParams }), controller.jobStatus);
adminRouter.get(
  '/exports/:jobId',
  validateRequest({ params: jobIdParams }),
  controller.exportStatus,
);
