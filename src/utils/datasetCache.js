import { DatasetManifest, ValidationRun } from '../models/index.js';

// Memoises expensive read-only aggregations per dataset version. The key includes the latest
// completed manifest (and validation run where relevant), so regenerating or revalidating the
// dataset invalidates cached results automatically. Bounded: one entry per (name, version).
const cache = new Map();
const MAX_ENTRIES = 200;

export async function datasetVersion({ includeValidation = false } = {}) {
  const manifest = await DatasetManifest.findOne({ status: 'COMPLETED' }, { manifestId: 1, _id: 0 })
    .sort({ createdAt: -1 })
    .lean();
  let version = manifest?.manifestId ?? 'none';
  if (includeValidation) {
    const run = await ValidationRun.findOne({}, { runId: 1, _id: 0 })
      .sort({ finishedAt: -1 })
      .lean();
    version += `:${run?.runId ?? 'none'}`;
  }
  return version;
}

export async function cached(name, compute, options = {}) {
  const key = `${name}@${await datasetVersion(options)}`;
  if (cache.has(key)) return cache.get(key);
  const promise = compute().catch((err) => {
    cache.delete(key);
    throw err;
  });
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, promise);
  return promise;
}

export const clearDatasetCache = () => cache.clear();
