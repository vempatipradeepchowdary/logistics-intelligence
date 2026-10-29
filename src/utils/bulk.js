import { DataWriteError } from './appError.js';

/**
 * Validated bulk insert of one bounded batch. Mongoose casts and validates every document
 * (strict schemas reject unknown fields). Any failure aborts the run with a DataWriteError.
 */
export async function insertBatch(model, docs) {
  if (!docs.length) return 0;
  try {
    await model.insertMany(docs, { ordered: true });
    return docs.length;
  } catch (err) {
    throw new DataWriteError(model.collection.collectionName, err);
  }
}

/** Insert from a (sync or async) iterable in bounded batches. */
export async function insertStream(model, iterable, batchSize, onBatch = () => {}) {
  let batch = [];
  let total = 0;
  for await (const doc of iterable) {
    batch.push(doc);
    if (batch.length >= batchSize) {
      total += await insertBatch(model, batch);
      batch = [];
      onBatch(total);
    }
  }
  total += await insertBatch(model, batch);
  onBatch(total);
  return total;
}
