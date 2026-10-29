// Job worker process: node src/jobs/worker.js <jobId>
// Runs one GENERATE / VALIDATE / EXPORT job, persisting progress, heartbeat, result or error.
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { resolveGenerationConfig } from '../config/generation.js';
import { Job } from '../models/index.js';
import { runGeneration } from '../services/generation.service.js';
import { runValidation } from '../services/validation.service.js';
import { resolveExportDir, runExport } from '../services/export.service.js';
import { logger } from '../utils/logger.js';

const jobIdValue = process.argv[2];
const HEARTBEAT_MS = 10_000;

async function execute(job, onProgress) {
  const p = job.params ?? {};
  switch (job.type) {
    case 'GENERATE': {
      const config = resolveGenerationConfig({
        profile: p.profile,
        seed: p.seed ?? env.GENERATION_SEED,
        batchSize: p.batchSize ?? env.BATCH_SIZE,
        overrides: p.overrides ?? {},
      });
      const manifest = await runGeneration({
        config,
        reset: Boolean(p.reset),
        resume: Boolean(p.resume),
        onProgress,
      });
      return {
        manifestId: manifest.manifestId,
        datasetChecksum: manifest.datasetChecksum,
        recordCounts: manifest.recordCounts,
        targetCounts: manifest.targetCounts,
      };
    }
    case 'VALIDATE': {
      const run = await runValidation({
        exportDir: resolveExportDir(p.exportLabel ?? 'latest'),
        onProgress,
      });
      return { runId: run.runId, status: run.status, summary: run.summary };
    }
    case 'EXPORT': {
      const out = await runExport({ label: p.label ?? 'latest', onProgress });
      return {
        label: p.label ?? 'latest',
        files: out.files.map(({ file, rows, sha256 }) => ({ file, rows, sha256 })),
      };
    }
    default:
      throw new Error(`Unsupported job type ${job.type}`);
  }
}

async function main() {
  await connectDatabase();
  const job = await Job.findOneAndUpdate(
    { jobId: jobIdValue, status: 'QUEUED' },
    {
      $set: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date(), pid: process.pid },
    },
    { new: true },
  ).lean();
  if (!job) throw new Error(`Job ${jobIdValue} is not QUEUED`);
  const heartbeat = setInterval(() => {
    Job.updateOne({ jobId: jobIdValue }, { $set: { heartbeatAt: new Date() } }).catch(() => {});
  }, HEARTBEAT_MS);
  let lastWrite = 0;
  const onProgress = ({ phase, processed = 0, total = 0, message = null }) => {
    const now = Date.now();
    if (now - lastWrite < 1000) return;
    lastWrite = now;
    const percent = total ? Math.round((processed / total) * 100) : 0;
    Job.updateOne(
      { jobId: jobIdValue },
      {
        $set: {
          progress: { phase, processed, total: total ?? 0, percent, message },
          heartbeatAt: new Date(),
        },
      },
    ).catch(() => {});
  };
  try {
    const result = await execute(job, onProgress);
    await Job.updateOne(
      { jobId: jobIdValue },
      {
        $set: {
          status: 'SUCCEEDED',
          result,
          finishedAt: new Date(),
          'progress.percent': 100,
          'progress.message': 'completed',
        },
        $unset: { activeLock: '' },
      },
    );
  } catch (err) {
    logger.error('job.failed', { jobId: jobIdValue, err });
    await Job.updateOne(
      { jobId: jobIdValue },
      {
        $set: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: { code: err.code ?? 'JOB_FAILED', message: err.message },
        },
        $unset: { activeLock: '' },
      },
    );
  } finally {
    clearInterval(heartbeat);
  }
}

main()
  .then(() => disconnectDatabase())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error('job.worker.fatal', { jobId: jobIdValue, err });
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
