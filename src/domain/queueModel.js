import { rngFor } from '../generators/rng.js';
import { queueObservationId } from '../utils/idGenerator.js';
import { HOUR, MINUTE } from '../utils/time.js';
import { weatherDwellAt } from './operations.js';

// Deterministic facility queue model. Queue state is piecewise-constant over 4-hour buckets.
// The physical simulator uses `queueExtraMinutes`; FacilityQueue records are observations of
// the same buckets, so queue delays in shipment legs are derived from the observed source data.

export const QUEUE_BUCKET_MINUTES = 240;
const BUCKET_MS = QUEUE_BUCKET_MINUTES * MINUTE;

// Peak hours by facility type (UTC hour of bucket start).
const PEAK_HOURS = { HUB: [20, 0], SORT_CENTER: [16, 20], DELIVERY_STATION: [4, 8] };

export const bucketOf = (ms) => Math.floor(ms / BUCKET_MS);
export const bucketStart = (bucket) => bucket * BUCKET_MS;

export function createQueueModel({ seed, facilitiesById, weatherIndex, startMs, asOfMs }) {
  const extraCache = new Map();
  const firstBucket = bucketOf(startMs);

  function queueExtraForBucket(facilityId, bucket) {
    const key = `${facilityId}:${bucket}`;
    const cached = extraCache.get(key);
    if (cached !== undefined) return cached;
    const facility = facilitiesById.get(facilityId);
    const rng = rngFor(seed, 'queue', facilityId, bucket);
    const startHour = new Date(bucketStart(bucket)).getUTCHours();
    const weekday = new Date(bucketStart(bucket)).getUTCDay();
    const diurnal = PEAK_HOURS[facility.type].includes(startHour) ? 1.7 : 0.85;
    const weekly = weekday === 1 ? 1.2 : weekday === 0 ? 0.8 : 1;
    const base = facility.baselineQueueWaitMinutes;
    const normal = Math.round(base * diurnal * weekly * rng.float(0.6, 1.4));
    const spike = rng.chance(0.05) ? rng.int(60, 240) : 0;
    const extra = Math.max(0, normal - base) + spike;
    extraCache.set(key, extra);
    return extra;
  }

  /** Physical queue delay (minutes above baseline) for a parcel arriving at `ms`. */
  const queueExtraMinutes = (facilityId, ms) => queueExtraForBucket(facilityId, bucketOf(ms));

  function ingestionLagMinutes(facilityId, bucket) {
    return rngFor(seed, 'queue-lag', facilityId, bucket).int(5, 25);
  }

  /** Observations exist for buckets in [start, asOf] whose ingestion also happened by asOf. */
  function observationExists(facilityId, bucket) {
    if (bucket < firstBucket) return false;
    const observedAt = bucketStart(bucket);
    return observedAt + ingestionLagMinutes(facilityId, bucket) * MINUTE <= asOfMs;
  }

  function observation(facilityId, bucket) {
    const facility = facilitiesById.get(facilityId);
    const observedAt = bucketStart(bucket);
    const ingestedAt = observedAt + ingestionLagMinutes(facilityId, bucket) * MINUTE;
    const rng = rngFor(seed, 'queue-obs', facilityId, bucket);
    const extra = queueExtraForBucket(facilityId, bucket);
    const weather = weatherDwellAt(weatherIndex, facilityId, observedAt);
    const active = weatherIndex.activeAt(facilityId, observedAt);
    const base = facility.baselineQueueWaitMinutes;
    const wait = base + extra + weather.minutes;
    const ratio = wait / Math.max(base, 1);
    const congestionLevel =
      ratio >= 6 ? 'SEVERE' : ratio >= 3 ? 'HIGH' : ratio >= 1.5 ? 'MODERATE' : 'LOW';
    const maxSeverity = active.reduce((m, ev) => Math.max(m, ev.severity), 0);
    const throughputPerHour = Math.round(
      facility.capacityPerHour * (maxSeverity ? 1 - maxSeverity * 0.1 : rng.float(0.85, 1)),
    );
    return {
      queueObservationId: queueObservationId(facilityId, observedAt),
      facilityId,
      observedAt: new Date(observedAt),
      ingestedAt: new Date(ingestedAt),
      windowMinutes: QUEUE_BUCKET_MINUTES,
      queueLength: Math.round((wait / 60) * facility.capacityPerHour * 0.9),
      throughputPerHour,
      utilizationPct: Math.min(200, Math.round(80 * (1 + (extra + weather.minutes) / (base + 60)))),
      estimatedWaitMinutes: wait,
      baselineWaitMinutes: base,
      congestionLevel,
      activeWeatherEventIds: active.map((ev) => ev.weatherEventId),
    };
  }

  /** Same contract as the DB-backed source: observations with observedAt in [fromMs, toMs]. */
  const source = {
    candidates(facilityId, fromMs, toMs) {
      const out = [];
      for (let b = Math.max(bucketOf(fromMs), firstBucket); bucketStart(b) <= toMs; b += 1) {
        if (bucketStart(b) < fromMs) continue;
        if (observationExists(facilityId, b)) out.push(observation(facilityId, b));
      }
      return out;
    },
  };

  return {
    queueExtraMinutes,
    observation,
    observationExists,
    firstBucket,
    lastBucket: bucketOf(asOfMs),
    source,
  };
}

/** DB-backed queue source with the same contract (binary search over per-facility sorted arrays). */
export function createQueueSourceFromDocs(observations) {
  const byFacility = new Map();
  for (const obs of observations) {
    const item = {
      queueObservationId: obs.queueObservationId,
      facilityId: obs.facilityId,
      observedAt: obs.observedAt,
      ingestedAt: obs.ingestedAt,
      estimatedWaitMinutes: obs.estimatedWaitMinutes,
      baselineWaitMinutes: obs.baselineWaitMinutes,
      _observedMs: obs.observedAt.getTime(),
    };
    if (!byFacility.has(obs.facilityId)) byFacility.set(obs.facilityId, []);
    byFacility.get(obs.facilityId).push(item);
  }
  for (const list of byFacility.values()) list.sort((a, b) => a._observedMs - b._observedMs);
  return {
    candidates(facilityId, fromMs, toMs) {
      const list = byFacility.get(facilityId);
      if (!list) return [];
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid]._observedMs < fromMs) lo = mid + 1;
        else hi = mid;
      }
      const out = [];
      for (let i = lo; i < list.length && list[i]._observedMs <= toMs; i += 1) out.push(list[i]);
      return out;
    },
  };
}

export const QUEUE_LOOKBACK_DEFAULT_MS = 8 * HOUR;
