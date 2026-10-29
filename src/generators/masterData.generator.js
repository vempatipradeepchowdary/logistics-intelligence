import { rngFor } from './rng.js';
import { carrierId, facilityId, routeId } from '../utils/idGenerator.js';
import { haversineKm } from '../utils/geo.js';
import { DAY } from '../utils/time.js';
import { distanceZone } from '../domain/sla.js';
import {
  AIR_MIN_GREAT_CIRCLE_KM,
  plannedAirMinutes,
  plannedGroundMinutes,
  ROAD_DISTANCE_FACTOR,
} from '../domain/network.js';

// [city, state, region, lat, lon, timezone, demandWeight]
const CITIES = [
  ['Atlanta', 'GA', 'SOUTHEAST', 33.749, -84.388, 'America/New_York', 5],
  ['Chicago', 'IL', 'MIDWEST', 41.878, -87.63, 'America/Chicago', 5],
  ['Dallas', 'TX', 'SOUTH_CENTRAL', 32.777, -96.797, 'America/Chicago', 5],
  ['Los Angeles', 'CA', 'WEST', 34.052, -118.244, 'America/Los_Angeles', 5],
  ['Newark', 'NJ', 'NORTHEAST', 40.736, -74.172, 'America/New_York', 5],
  ['Memphis', 'TN', 'SOUTHEAST', 35.149, -90.049, 'America/Chicago', 3],
  ['Denver', 'CO', 'MOUNTAIN', 39.739, -104.99, 'America/Denver', 4],
  ['Seattle', 'WA', 'NORTHWEST', 47.606, -122.332, 'America/Los_Angeles', 4],
  ['Phoenix', 'AZ', 'SOUTHWEST', 33.448, -112.074, 'America/Phoenix', 4],
  ['Kansas City', 'MO', 'MIDWEST', 39.1, -94.578, 'America/Chicago', 3],
  ['Charlotte', 'NC', 'SOUTHEAST', 35.227, -80.843, 'America/New_York', 3],
  ['Columbus', 'OH', 'MIDWEST', 39.961, -82.999, 'America/New_York', 3],
  ['Salt Lake City', 'UT', 'MOUNTAIN', 40.761, -111.891, 'America/Denver', 2],
  ['Houston', 'TX', 'SOUTH_CENTRAL', 29.76, -95.37, 'America/Chicago', 5],
  ['Miami', 'FL', 'SOUTHEAST', 25.762, -80.192, 'America/New_York', 4],
  ['Boston', 'MA', 'NORTHEAST', 42.36, -71.059, 'America/New_York', 4],
  ['Minneapolis', 'MN', 'MIDWEST', 44.978, -93.265, 'America/Chicago', 3],
  ['Portland', 'OR', 'NORTHWEST', 45.515, -122.679, 'America/Los_Angeles', 3],
  ['San Francisco', 'CA', 'WEST', 37.775, -122.419, 'America/Los_Angeles', 4],
  ['Nashville', 'TN', 'SOUTHEAST', 36.163, -86.781, 'America/Chicago', 3],
  ['Indianapolis', 'IN', 'MIDWEST', 39.768, -86.158, 'America/New_York', 3],
  ['St. Louis', 'MO', 'MIDWEST', 38.627, -90.199, 'America/Chicago', 3],
  ['Orlando', 'FL', 'SOUTHEAST', 28.538, -81.379, 'America/New_York', 3],
  ['Pittsburgh', 'PA', 'NORTHEAST', 40.441, -79.996, 'America/New_York', 2],
  ['Albuquerque', 'NM', 'SOUTHWEST', 35.084, -106.65, 'America/Denver', 2],
  ['Oklahoma City', 'OK', 'SOUTH_CENTRAL', 35.468, -97.516, 'America/Chicago', 2],
  ['Sacramento', 'CA', 'WEST', 38.582, -121.494, 'America/Los_Angeles', 2],
  ['Detroit', 'MI', 'MIDWEST', 42.331, -83.046, 'America/Detroit', 3],
  ['Las Vegas', 'NV', 'SOUTHWEST', 36.17, -115.14, 'America/Los_Angeles', 3],
  ['Baltimore', 'MD', 'NORTHEAST', 39.29, -76.612, 'America/New_York', 3],
  ['Austin', 'TX', 'SOUTH_CENTRAL', 30.267, -97.743, 'America/Chicago', 3],
  ['San Antonio', 'TX', 'SOUTH_CENTRAL', 29.424, -98.494, 'America/Chicago', 3],
  ['San Diego', 'CA', 'WEST', 32.716, -117.161, 'America/Los_Angeles', 3],
  ['Tampa', 'FL', 'SOUTHEAST', 27.951, -82.457, 'America/New_York', 3],
  ['Raleigh', 'NC', 'SOUTHEAST', 35.78, -78.639, 'America/New_York', 2],
  ['Richmond', 'VA', 'NORTHEAST', 37.541, -77.436, 'America/New_York', 2],
  ['Milwaukee', 'WI', 'MIDWEST', 43.039, -87.906, 'America/Chicago', 2],
  ['Omaha', 'NE', 'MIDWEST', 41.257, -95.935, 'America/Chicago', 2],
  ['Boise', 'ID', 'NORTHWEST', 43.615, -116.202, 'America/Boise', 1],
  ['Spokane', 'WA', 'NORTHWEST', 47.659, -117.426, 'America/Los_Angeles', 1],
  ['Tucson', 'AZ', 'SOUTHWEST', 32.222, -110.975, 'America/Phoenix', 2],
  ['El Paso', 'TX', 'SOUTH_CENTRAL', 31.762, -106.485, 'America/Denver', 1],
  ['New Orleans', 'LA', 'SOUTH_CENTRAL', 29.951, -90.072, 'America/Chicago', 2],
  ['Louisville', 'KY', 'SOUTHEAST', 38.253, -85.759, 'America/New_York', 2],
  ['Cleveland', 'OH', 'MIDWEST', 41.499, -81.694, 'America/New_York', 2],
  ['Buffalo', 'NY', 'NORTHEAST', 42.886, -78.878, 'America/New_York', 1],
  ['Hartford', 'CT', 'NORTHEAST', 41.765, -72.685, 'America/New_York', 1],
  ['Philadelphia', 'PA', 'NORTHEAST', 39.953, -75.165, 'America/New_York', 5],
  ['Birmingham', 'AL', 'SOUTHEAST', 33.519, -86.81, 'America/Chicago', 1],
  ['Jacksonville', 'FL', 'SOUTHEAST', 30.332, -81.656, 'America/New_York', 2],
];

const HUB_COUNT = 14;
const SORT_CENTER_COUNT = 16;
const STATION_COUNT = 70;

const FACILITY_PROFILES = {
  HUB: { capacity: [2500, 6000], processing: 120, queue: 30, label: 'Regional Hub' },
  SORT_CENTER: { capacity: [900, 2200], processing: 90, queue: 20, label: 'Sort Center' },
  DELIVERY_STATION: { capacity: [250, 700], processing: 45, queue: 10, label: 'Delivery Station' },
};

export const SERVICE_LEVELS = Object.freeze([
  {
    serviceLevelId: 'SL-EXPRESS',
    name: 'Express (1-2 Day Air)',
    transportMode: 'AIR',
    transitDaysByZone: { Z1: 1, Z2: 1, Z3: 2, Z4: 2 },
    pickupCutoffMinuteUtc: 17 * 60,
    deadlineMinuteUtc: 23 * 60 + 59,
    handlingFactor: 0.5,
    atRiskBufferMinutes: 120,
    priority: 1,
    mixWeight: 14,
  },
  {
    serviceLevelId: 'SL-PRIORITY',
    name: 'Priority Two Day',
    transportMode: 'AIR',
    transitDaysByZone: { Z1: 2, Z2: 2, Z3: 2, Z4: 2 },
    pickupCutoffMinuteUtc: 17 * 60,
    deadlineMinuteUtc: 23 * 60 + 59,
    handlingFactor: 0.75,
    atRiskBufferMinutes: 180,
    priority: 2,
    mixWeight: 24,
  },
  {
    serviceLevelId: 'SL-STANDARD',
    name: 'Standard Ground',
    transportMode: 'GROUND',
    transitDaysByZone: { Z1: 2, Z2: 2, Z3: 3, Z4: 5 },
    pickupCutoffMinuteUtc: 16 * 60,
    deadlineMinuteUtc: 23 * 60 + 59,
    handlingFactor: 1,
    atRiskBufferMinutes: 240,
    priority: 3,
    mixWeight: 46,
  },
  {
    serviceLevelId: 'SL-ECONOMY',
    name: 'Economy Ground',
    transportMode: 'GROUND',
    transitDaysByZone: { Z1: 2, Z2: 3, Z3: 4, Z4: 5 },
    pickupCutoffMinuteUtc: 15 * 60,
    deadlineMinuteUtc: 23 * 60 + 59,
    handlingFactor: 2.0,
    atRiskBufferMinutes: 360,
    priority: 4,
    mixWeight: 16,
  },
]);

// Synthetic carriers (fictional names). transitTimeFactor is the configured historical estimate.
const CARRIER_DEFS = [
  [
    'Meridian Express Logistics',
    'MRDX',
    'MULTIMODAL',
    ['SL-EXPRESS', 'SL-PRIORITY', 'SL-STANDARD'],
    1.0,
    0.08,
    0.985,
    0.05,
    0.96,
    14,
  ],
  [
    'Bluewater Parcel',
    'BLWP',
    'MULTIMODAL',
    ['SL-EXPRESS', 'SL-PRIORITY', 'SL-STANDARD', 'SL-ECONOMY'],
    1.03,
    0.1,
    0.975,
    0.1,
    0.94,
    18,
  ],
  [
    'Summit Ground Freight',
    'SMGF',
    'GROUND',
    ['SL-STANDARD', 'SL-ECONOMY'],
    1.06,
    0.13,
    0.95,
    0.2,
    0.92,
    15,
  ],
  [
    'Prairie Line Couriers',
    'PRLC',
    'GROUND',
    ['SL-STANDARD', 'SL-ECONOMY'],
    1.09,
    0.16,
    0.93,
    0.3,
    0.9,
    10,
  ],
  [
    'Coastal Relay Shipping',
    'CRSH',
    'MULTIMODAL',
    ['SL-PRIORITY', 'SL-STANDARD', 'SL-ECONOMY'],
    1.04,
    0.11,
    0.96,
    0.15,
    0.93,
    12,
  ],
  [
    'Ironhorse Transport',
    'IRHT',
    'GROUND',
    ['SL-STANDARD', 'SL-ECONOMY'],
    1.11,
    0.18,
    0.92,
    0.35,
    0.88,
    8,
  ],
  [
    'Skybridge Air Cargo',
    'SKAC',
    'AIR',
    ['SL-EXPRESS', 'SL-PRIORITY'],
    0.98,
    0.07,
    0.99,
    0.05,
    0.97,
    9,
  ],
  [
    'Northstar Freightways',
    'NSFW',
    'MULTIMODAL',
    ['SL-EXPRESS', 'SL-PRIORITY', 'SL-STANDARD', 'SL-ECONOMY'],
    1.02,
    0.1,
    0.97,
    0.12,
    0.95,
    14,
  ],
];

export function buildCarriers() {
  return CARRIER_DEFS.map(
    ([name, code, mode, sls, factor, variability, scan, edi, pickup, share], i) => ({
      carrierId: carrierId(i + 1),
      name,
      code,
      mode,
      supportedServiceLevelIds: sls,
      transitTimeFactor: factor,
      transitVariability: variability,
      scanComplianceRate: scan,
      ediBatchShare: edi,
      onTimePickupRate: pickup,
      marketShareWeight: share,
      active: true,
    }),
  );
}

export const buildServiceLevels = () =>
  SERVICE_LEVELS.map((sl) => ({ ...sl, transitDaysByZone: { ...sl.transitDaysByZone } }));

function makeFacility(seed, index, type, city, jitter) {
  const rng = rngFor(seed, 'facility', index);
  const [cityName, state, region, lat, lon, tz] = city;
  const profile = FACILITY_PROFILES[type];
  const id = facilityId(index);
  return {
    facilityId: id,
    name: `${cityName} ${profile.label}${jitter ? ` ${index}` : ''}`,
    type,
    city: cityName,
    stateCode: state,
    region,
    latitude: Number((lat + (jitter ? rng.float(-0.25, 0.25) : 0)).toFixed(4)),
    longitude: Number((lon + (jitter ? rng.float(-0.25, 0.25) : 0)).toFixed(4)),
    timezone: tz,
    parentHubId: null,
    capacityPerHour: rng.int(profile.capacity[0], profile.capacity[1]),
    baseProcessingMinutes: profile.processing + rng.int(-10, 10),
    baselineQueueWaitMinutes: profile.queue + rng.int(-5, 5),
    operatingStatus: 'ACTIVE',
  };
}

const nearest = (from, candidates) =>
  candidates.reduce((best, c) => (haversineKm(from, c) < haversineKm(from, best) ? c : best));

/** 14 hubs, 16 sort centers, 70 delivery stations; each non-hub feeds its nearest hub. */
export function buildFacilities(seed) {
  const facilities = [];
  let index = 1;
  for (let i = 0; i < HUB_COUNT; i += 1)
    facilities.push(makeFacility(seed, index++, 'HUB', CITIES[i], false));
  for (let i = 0; i < SORT_CENTER_COUNT; i += 1) {
    facilities.push(makeFacility(seed, index++, 'SORT_CENTER', CITIES[HUB_COUNT + i], false));
  }
  // One station per city, then second stations in the highest-demand cities.
  const stationCities = [...CITIES];
  const secondary = CITIES.filter((c) => c[6] >= 3).slice(0, STATION_COUNT - CITIES.length);
  stationCities.push(...secondary);
  for (const city of stationCities.slice(0, STATION_COUNT)) {
    facilities.push(makeFacility(seed, index++, 'DELIVERY_STATION', city, true));
  }
  const hubs = facilities.filter((f) => f.type === 'HUB');
  for (const f of facilities) if (f.type !== 'HUB') f.parentHubId = nearest(f, hubs).facilityId;
  return facilities;
}

export function stationDemandWeight(station) {
  const city = CITIES.find((c) => c[0] === station.city);
  return city ? city[6] : 1;
}

function buildLeg(sequence, from, to) {
  const greatCircle = haversineKm(from, to);
  const distanceKm = Math.max(5, Math.round(greatCircle * ROAD_DISTANCE_FACTOR));
  const airEligible =
    from.type !== 'DELIVERY_STATION' &&
    to.type !== 'DELIVERY_STATION' &&
    greatCircle > AIR_MIN_GREAT_CIRCLE_KM;
  return {
    sequence,
    fromFacilityId: from.facilityId,
    toFacilityId: to.facilityId,
    distanceKm,
    plannedGroundMinutes: plannedGroundMinutes(distanceKm),
    plannedAirMinutes: airEligible ? plannedAirMinutes(greatCircle) : null,
  };
}

function buildRouteDoc(id, routeType, primaryRouteId, path, effectiveFrom) {
  const legs = [];
  for (let i = 0; i < path.length - 1; i += 1) legs.push(buildLeg(i + 1, path[i], path[i + 1]));
  const totalDistanceKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  return {
    routeId: id,
    version: 1,
    routeType,
    primaryRouteId,
    originFacilityId: path[0].facilityId,
    destinationFacilityId: path[path.length - 1].facilityId,
    stops: path.map((f, i) => ({ sequence: i, facilityId: f.facilityId })),
    legs,
    totalDistanceKm,
    distanceZone: distanceZone(totalDistanceKm),
    effectiveFrom: new Date(effectiveFrom),
  };
}

/**
 * Routes for every ordered station pair.
 * PRIMARY: station -> origin hub -> (destination hub) -> station.
 * ALTERNATE (cross-hub pairs only): station -> origin hub -> sort center nearest the
 * destination -> station, bypassing the destination hub (used for weather/capacity reroutes).
 */
export function buildRoutes(facilities, startMs) {
  const byId = new Map(facilities.map((f) => [f.facilityId, f]));
  const stations = facilities.filter((f) => f.type === 'DELIVERY_STATION');
  const sortCenters = facilities.filter((f) => f.type === 'SORT_CENTER');
  const effectiveFrom = startMs - 30 * DAY;
  const routes = [];
  let n = 1;
  for (const o of stations) {
    for (const d of stations) {
      if (o.facilityId === d.facilityId) continue;
      const hubO = byId.get(o.parentHubId);
      const hubD = byId.get(d.parentHubId);
      const path = hubO.facilityId === hubD.facilityId ? [o, hubO, d] : [o, hubO, hubD, d];
      const primary = buildRouteDoc(routeId(n++), 'PRIMARY', null, path, effectiveFrom);
      routes.push(primary);
      if (hubO.facilityId !== hubD.facilityId) {
        const sc = nearest(d, sortCenters);
        routes.push(
          buildRouteDoc(
            routeId(n++),
            'ALTERNATE',
            primary.routeId,
            [o, hubO, sc, d],
            effectiveFrom,
          ),
        );
      }
    }
  }
  return routes;
}

export function buildRouteIndex(routes) {
  const byId = new Map();
  const byPair = new Map();
  for (const r of routes) {
    byId.set(r.routeId, r);
    const key = `${r.originFacilityId}>${r.destinationFacilityId}`;
    if (!byPair.has(key)) byPair.set(key, {});
    byPair.get(key)[r.routeType === 'PRIMARY' ? 'primary' : 'alternate'] = r;
  }
  return { byId, byPair, forPair: (o, d) => byPair.get(`${o}>${d}`) };
}
