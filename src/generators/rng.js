// Seeded pseudo-random number generation.
//
// Every record family draws from its own keyed sub-stream: rngFor(seed, 'shipment', 42).
// A record's random values therefore depend only on (seed, namespace, key), never on how many
// numbers were drawn before it. That makes generation order-independent, batchable and resumable.

/** cyrb53 string hash, folded to an unsigned 32-bit integer. */
export function hash32(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 & 0x1fffff) * 4294967296 + (h1 >>> 0)) >>> 0;
}

export class Rng {
  constructor(seed32) {
    this.state = seed32 >>> 0;
  }

  /** mulberry32: uniform float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min, max) {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted choice; weights need not sum to 1. */
  weighted(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Standard normal via Box-Muller. */
  normal(mean = 0, sd = 1) {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Multiplicative noise with median 1 (exp(N(0, sigma))). */
  lognormalFactor(sigma) {
    return Math.exp(this.normal(0, sigma));
  }

  /** Deterministic Fisher-Yates shuffle of a typed or plain array (in place). */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }
}

export const seedFor = (seed, ...parts) => hash32(`${seed}|${parts.join('|')}`);
export const rngFor = (seed, ...parts) => new Rng(seedFor(seed, ...parts));
