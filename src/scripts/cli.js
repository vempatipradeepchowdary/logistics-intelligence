import { parseArgs } from 'node:util';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Shared CLI bootstrap: parse args, connect, run, always disconnect, exit non-zero on failure. */
export async function runCli(options, handler) {
  const { values } = parseArgs({
    options: { db: { type: 'string' }, help: { type: 'boolean', short: 'h' }, ...options },
    allowPositionals: false,
  });
  if (values.db && !/^[A-Za-z0-9_-]{1,60}$/.test(values.db)) throw new Error('Invalid --db name');
  const started = Date.now();
  let exitCode = 0;
  try {
    await connectDatabase({ dbName: values.db ?? env.ACTIVE_DB_NAME });
    exitCode = (await handler(values)) ?? 0;
  } catch (err) {
    logger.error('cli.failed', { err });
    console.error(`\nFAILED: ${err.message}`);
    exitCode = 1;
  } finally {
    await disconnectDatabase();
    logger.info('cli.finished', { durationMs: Date.now() - started, exitCode });
  }
  process.exitCode = exitCode;
}
