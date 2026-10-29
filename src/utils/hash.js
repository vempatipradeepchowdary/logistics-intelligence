import { createHash } from 'node:crypto';

/** Canonical JSON: sorted object keys, Dates as ISO strings, undefined dropped. Stable across runs. */
export function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString(); // ObjectId
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));

export const sha256 = (input) => createHash('sha256').update(input).digest('hex');

export const hashObject = (value) => sha256(canonicalJson(value));

/** Incremental hasher for streaming large collections. */
export function createStreamHasher() {
  const hash = createHash('sha256');
  let count = 0;
  return {
    add(value) {
      hash.update(canonicalJson(value));
      hash.update('\n');
      count += 1;
    },
    digest: () => ({ sha256: hash.digest('hex'), count }),
  };
}
