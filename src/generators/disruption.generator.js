import { rngFor } from './rng.js';
import { weatherEventId } from '../utils/idGenerator.js';
import { haversineKm } from '../utils/geo.js';
import { DAY, HOUR, MINUTE, floorToMinute } from '../utils/time.js';
import {
  WEATHER_DWELL_DELAY_BY_SEVERITY,
  WEATHER_TRANSIT_SLOWDOWN_PCT_PER_SEVERITY,
} from '../domain/operations.js';

// Regional weather climatology (relative weights per weather type).
const REGION_WEATHER = {
  NORTHEAST: { SNOW: 5, ICE: 3, THUNDERSTORM: 2, FOG: 2, HIGH_WIND: 2 },
  MIDWEST: { SNOW: 5, ICE: 3, THUNDERSTORM: 2, HIGH_WIND: 2, FOG: 1 },
  NORTHWEST: { FOG: 4, SNOW: 3, HIGH_WIND: 2, ICE: 1, THUNDERSTORM: 1 },
  MOUNTAIN: { SNOW: 6, HIGH_WIND: 3, ICE: 2 },
  SOUTHEAST: { THUNDERSTORM: 5, FLOOD: 2, HURRICANE: 1, FOG: 2, ICE: 1 },
  SOUTH_CENTRAL: { THUNDERSTORM: 5, ICE: 2, FLOOD: 2, HIGH_WIND: 2, HURRICANE: 1 },
  SOUTHWEST: { HIGH_WIND: 4, EXTREME_HEAT: 3, THUNDERSTORM: 2, FLOOD: 1 },
  WEST: { FOG: 4, HIGH_WIND: 3, EXTREME_HEAT: 2, FLOOD: 1 },
};
const SEVERITY_WEIGHTS = [0.42, 0.3, 0.16, 0.08, 0.04];

/**
 * Generate disruption windows. Each window is centred on a facility and affects every facility
 * within its radius. 70% are FORECAST advisories (issued 6-72h before start), 30% NOWCAST
 * (issued up to 90 min after start) - i.e. only knowable once the disruption has begun.
 */
export function generateWeatherEvents({ seed, count, facilities, startMs, asOfMs, year }) {
  const windowStart = startMs - 2 * DAY;
  const windowEnd = asOfMs - 3 * HOUR;
  const raw = [];
  for (let i = 1; i <= count; i += 1) {
    const rng = rngFor(seed, 'weather', i);
    const center = facilities[rng.int(0, facilities.length - 1)];
    const climatology = REGION_WEATHER[center.region];
    const types = Object.keys(climatology);
    const weatherType = rng.weighted(
      types,
      types.map((t) => climatology[t]),
    );
    const severity = rng.weighted([1, 2, 3, 4, 5], SEVERITY_WEIGHTS);
    const startAt = floorToMinute(windowStart + rng.next() * (windowEnd - windowStart));
    const endAt = startAt + rng.int(2, 6 + severity * 8) * HOUR + rng.int(0, 59) * MINUTE;
    const radiusKm = 60 + severity * 60 + rng.int(0, 100);
    const affectedFacilityIds = facilities
      .filter((f) => haversineKm(center, f) <= radiusKm)
      .map((f) => f.facilityId)
      .sort();
    const forecast = rng.chance(0.7);
    const issuedAt = forecast
      ? startAt - rng.int(6 * 60, 72 * 60) * MINUTE
      : startAt + rng.int(0, 90) * MINUTE;
    const ingestedAt = issuedAt + rng.int(1, 20) * MINUTE;
    raw.push({
      order: i,
      weatherType,
      severity,
      advisoryType: forecast ? 'FORECAST' : 'NOWCAST',
      centerFacilityId: center.facilityId,
      affectedFacilityIds,
      radiusKm,
      startAt,
      endAt,
      issuedAt,
      ingestedAt,
      expectedDelayMinutes: Math.round(
        WEATHER_DWELL_DELAY_BY_SEVERITY[severity] * rng.float(0.8, 1.2),
      ),
      transitSlowdownPct: severity * WEATHER_TRANSIT_SLOWDOWN_PCT_PER_SEVERITY,
    });
  }
  // IDs follow chronological order of window start (ties broken by draw order).
  raw.sort((a, b) => a.startAt - b.startAt || a.order - b.order);
  return raw.map(({ order: _order, ...ev }, idx) => ({
    weatherEventId: weatherEventId(year, idx + 1),
    ...ev,
    startAt: new Date(ev.startAt),
    endAt: new Date(ev.endAt),
    issuedAt: new Date(ev.issuedAt),
    ingestedAt: new Date(ev.ingestedAt),
  }));
}

/** Stream facility queue observations (every 4h per facility) in deterministic order. */
export function* generateQueueObservations({ queueModel, facilities }) {
  for (const facility of facilities) {
    for (let b = queueModel.firstBucket; b <= queueModel.lastBucket; b += 1) {
      if (queueModel.observationExists(facility.facilityId, b)) {
        yield queueModel.observation(facility.facilityId, b);
      }
    }
  }
}
