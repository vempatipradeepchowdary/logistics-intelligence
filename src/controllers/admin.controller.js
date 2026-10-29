import { env } from '../config/env.js';
import { resolveGenerationConfig } from '../config/generation.js';
import { getJob, listJobs, startJob } from '../services/job.service.js';
import { sendOk } from '../utils/response.js';

const accepted = (res, job) =>
  sendOk(
    res,
    job,
    {
      statusUrl:
        job.type === 'EXPORT' ? `/api/admin/exports/${job.jobId}` : `/api/admin/jobs/${job.jobId}`,
    },
    202,
  );

export async function generate(req, res) {
  const body = req.valid.body;
  // Validate the effective configuration up front (400 instead of a failed background job).
  const config = resolveGenerationConfig({
    profile: body.profile,
    seed: body.seed ?? env.GENERATION_SEED,
    batchSize: body.batchSize ?? env.BATCH_SIZE,
    overrides: body.overrides ?? {},
  });
  const job = await startJob('GENERATE', body);
  return sendOk(
    res,
    job,
    { statusUrl: `/api/admin/jobs/${job.jobId}`, effectiveConfig: config },
    202,
  );
}

export const validate = async (req, res) =>
  accepted(res, await startJob('VALIDATE', req.valid.body));
export const exportData = async (req, res) =>
  accepted(res, await startJob('EXPORT', req.valid.body));
export const jobStatus = async (req, res) => sendOk(res, await getJob(req.valid.params.jobId));
export const exportStatus = async (req, res) =>
  sendOk(res, await getJob(req.valid.params.jobId, 'EXPORT'));
export async function jobs(req, res) {
  const { items, active } = await listJobs(req.valid.query);
  return sendOk(res, items, { active, count: items.length });
}
