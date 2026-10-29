import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Job } from '../models/index.js';
import { AppError } from '../utils/appError.js';
import { jobId as makeJobId } from '../utils/idGenerator.js';
import { logger } from '../utils/logger.js';

export const ACTIVE_LOCK = 'DATA_JOB';
export const STALE_AFTER_MS = 60_000;
const WORKER = fileURLToPath(new URL('../jobs/worker.js', import.meta.url));

const publicJob = (job) => {
  if (!job) return null;
  const { _id, activeLock: _lock, pid: _pid, ...rest } = job.toObject ? job.toObject() : job;
  return rest;
};

/**
 * Create a persistent job and run it in a separate worker process, so long CPU/IO-heavy work
 * never blocks the API event loop. At most one data job is active at a time (unique activeLock).
 */
export async function startJob(type, params) {
  let job;
  try {
    job = await Job.create({
      jobId: makeJobId(type),
      type,
      status: 'QUEUED',
      params,
      activeLock: ACTIVE_LOCK,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const active = await Job.findOne({ activeLock: ACTIVE_LOCK }).lean();
      throw new AppError('JOB_CONFLICT', 'Another data job is already queued or running', 409, [
        { jobId: active?.jobId, type: active?.type, status: active?.status },
      ]);
    }
    throw err;
  }
  const child = fork(WORKER, [job.jobId], { stdio: 'inherit', env: process.env });
  child.on('exit', async (code) => {
    if (code === 0) return;
    // The worker records its own failures; this covers crashes before it could.
    await Job.updateOne(
      { jobId: job.jobId, status: { $in: ['QUEUED', 'RUNNING'] } },
      {
        $set: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: { code: 'WORKER_CRASHED', message: `Worker exited with code ${code}` },
        },
        $unset: { activeLock: '' },
      },
    ).catch((err) => logger.error('job.exit.update_failed', { err }));
  });
  child.on('error', (err) => logger.error('job.worker.spawn_failed', { jobId: job.jobId, err }));
  return publicJob(job);
}

export async function getJob(jobIdValue, type) {
  const job = await Job.findOne({ jobId: jobIdValue }).lean();
  if (!job || (type && job.type !== type))
    throw new AppError('NOT_FOUND', `Job ${jobIdValue} not found`, 404);
  return publicJob(job);
}

export async function listJobs({ type, limit }) {
  const jobs = await Job.find(type ? { type } : {})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const active = await Job.findOne(
    { activeLock: ACTIVE_LOCK },
    { jobId: 1, type: 1, status: 1, _id: 0 },
  ).lean();
  return { items: jobs.map(publicJob), active };
}

/** On startup: jobs whose worker stopped heart-beating are marked FAILED and the lock released. */
export async function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const result = await Job.updateMany(
    {
      status: { $in: ['QUEUED', 'RUNNING'] },
      $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: null, createdAt: { $lt: cutoff } }],
    },
    {
      $set: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: { code: 'STALE_JOB', message: 'Worker stopped responding' },
      },
      $unset: { activeLock: '' },
    },
  );
  if (result.modifiedCount) logger.warn('jobs.recovered_stale', { count: result.modifiedCount });
  return result.modifiedCount;
}
