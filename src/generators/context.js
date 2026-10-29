import { DAY } from '../utils/time.js';
import { buildWeatherIndex } from '../domain/operations.js';
import { createQueueModel } from '../domain/queueModel.js';
import {
  buildCarriers,
  buildFacilities,
  buildRouteIndex,
  buildRoutes,
  buildServiceLevels,
  stationDemandWeight,
} from './masterData.generator.js';
import { generateWeatherEvents } from './disruption.generator.js';

/**
 * Build the complete in-memory reference context for a generation config. Everything here is a
 * pure function of (seed, config), which is what makes batches independently reproducible.
 */
export function buildGenerationContext(config) {
  const seed = config.seed;
  const startMs = Date.parse(config.simulationStart);
  const asOfMs = startMs + config.simulationDays * DAY;
  const year = new Date(startMs).getUTCFullYear();

  const carriers = buildCarriers();
  const serviceLevels = buildServiceLevels();
  const facilities = buildFacilities(seed);
  const routes = buildRoutes(facilities, startMs);
  const weatherEvents = generateWeatherEvents({
    seed,
    count: config.weatherEvents,
    facilities,
    startMs,
    asOfMs,
    year,
  });

  const facilitiesById = new Map(facilities.map((f) => [f.facilityId, f]));
  const weatherIndex = buildWeatherIndex(weatherEvents);
  const stations = facilities.filter((f) => f.type === 'DELIVERY_STATION');
  const carriersByServiceLevel = new Map(
    serviceLevels.map((sl) => [
      sl.serviceLevelId,
      carriers.filter((c) => c.supportedServiceLevelIds.includes(sl.serviceLevelId)),
    ]),
  );

  return {
    config,
    seed,
    year,
    startMs,
    asOfMs,
    carriers,
    carriersById: new Map(carriers.map((c) => [c.carrierId, c])),
    carriersByServiceLevel,
    serviceLevels,
    serviceLevelsById: new Map(serviceLevels.map((s) => [s.serviceLevelId, s])),
    facilities,
    facilitiesById,
    stations,
    stationWeights: stations.map(stationDemandWeight),
    routes,
    routeIndex: buildRouteIndex(routes),
    weatherEvents,
    weatherIndex,
    queueModel: createQueueModel({ seed, facilitiesById, weatherIndex, startMs, asOfMs }),
  };
}
