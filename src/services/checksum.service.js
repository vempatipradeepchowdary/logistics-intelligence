import { DATASET_ENTITIES } from '../models/index.js';
import { createStreamHasher, sha256 } from '../utils/hash.js';

/**
 * Deterministic content checksums computed from the database: each collection is streamed in
 * business-ID order, Mongo `_id` excluded, and hashed as canonical JSON lines. Identical seeds and
 * configs therefore produce identical checksums regardless of insertion timing.
 */
export async function computeDatasetChecksums() {
  const collections = {};
  for (const { name, model, idField } of DATASET_ENTITIES) {
    const hasher = createStreamHasher();
    const cursor = model
      .find({}, { _id: 0 })
      .sort({ [idField]: 1 })
      .lean()
      .cursor({ batchSize: 2000 });
    for await (const doc of cursor) hasher.add(doc);
    collections[name] = hasher.digest();
  }
  const datasetChecksum = sha256(
    DATASET_ENTITIES.map(
      ({ name }) => `${name}:${collections[name].sha256}:${collections[name].count}`,
    ).join('\n'),
  );
  return { collections, datasetChecksum };
}

/** Record counts split by partition for partitioned collections. */
export async function computeRecordCounts() {
  const counts = {};
  for (const { name, model, partitioned } of DATASET_ENTITIES) {
    const total = await model.countDocuments({});
    if (partitioned) {
      const [baseline, anomaly] = await Promise.all([
        model.countDocuments({ partition: 'BASELINE' }),
        model.countDocuments({ partition: 'ANOMALY' }),
      ]);
      counts[name] = { total, baseline, anomaly };
    } else {
      counts[name] = { total, baseline: total, anomaly: 0 };
    }
  }
  return counts;
}
