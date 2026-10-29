import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { ensureIndexes } from './models/index.js';
import { recoverStaleJobs } from './services/job.service.js';
import { logger } from './utils/logger.js';

async function start() {
  await connectDatabase();
  await ensureIndexes();
  await recoverStaleJobs();
  const app = createApp();
  const server = app.listen(env.PORT, () =>
    logger.info('server.listening', { port: env.PORT, env: env.NODE_ENV }),
  );

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.shutdown', { signal });
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      await disconnectDatabase();
      clearTimeout(force);
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error('process.unhandledRejection', { err }));
}

start().catch((err) => {
  logger.error('server.start_failed', { err });
  process.exit(1);
});
