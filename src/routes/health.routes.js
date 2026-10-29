import { Router } from 'express';
import mongoose from 'mongoose';
import { databaseState } from '../config/database.js';
import { sendOk } from '../utils/response.js';
import { SOFTWARE_VERSION } from '../utils/version.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const state = databaseState();
  let pingMs = null;
  if (state === 'connected') {
    const started = Date.now();
    try {
      await mongoose.connection.db.admin().ping();
      pingMs = Date.now() - started;
    } catch {
      pingMs = null;
    }
  }
  const healthy = state === 'connected' && pingMs !== null;
  return sendOk(
    res,
    {
      status: healthy ? 'ok' : 'degraded',
      version: SOFTWARE_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      database: { state, pingMs },
      timestamp: new Date().toISOString(),
    },
    {},
    healthy ? 200 : 503,
  );
});
