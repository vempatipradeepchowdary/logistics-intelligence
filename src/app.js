import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { healthRouter } from './routes/health.routes.js';
import { shipmentRouter } from './routes/shipment.routes.js';
import { analyticsRouter } from './routes/analytics.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import {
  disruptionRouter,
  etaRouter,
  eventRouter,
  exportRouter,
  facilityRouter,
  systemRouter,
} from './routes/explorer.routes.js';
import { sendError } from './utils/response.js';

const FRONTEND_DIST = fileURLToPath(new URL('../frontend/dist', import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple'); // flat string values only; blocks nested-object query injection
  app.use(helmet());
  app.use(requestLogger);
  app.use(express.json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
  app.use(
    '/api',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, res) => sendError(res, 429, 'RATE_LIMITED', 'Too many requests; slow down'),
    }),
  );

  app.use('/api/health', healthRouter);
  app.use('/api/shipments', shipmentRouter);
  app.use('/api/events', eventRouter);
  app.use('/api/facilities', facilityRouter);
  app.use('/api/disruptions', disruptionRouter);
  app.use('/api/etas', etaRouter);
  app.use('/api/exports', exportRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/admin', adminRouter);

  // Serve the built React frontend (if present) with client-side routing fallback.
  if (existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
    app.use(express.static(FRONTEND_DIST, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
