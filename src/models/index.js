import { Carrier } from './Carrier.js';
import { ServiceLevel } from './ServiceLevel.js';
import { Facility } from './Facility.js';
import { Route } from './Route.js';
import { Shipment } from './Shipment.js';
import { ShipmentLeg } from './ShipmentLeg.js';
import { TrackingEvent } from './TrackingEvent.js';
import { FacilityQueue } from './FacilityQueue.js';
import { WeatherEvent } from './WeatherEvent.js';
import { ETAEstimate } from './ETAEstimate.js';
import { DelayReason } from './DelayReason.js';
import { GroundTruth } from './GroundTruth.js';
import { AnomalyCase } from './AnomalyCase.js';
import { Job } from './GenerationJob.js';
import { ValidationRun } from './ValidationRun.js';
import { DatasetManifest } from './DatasetManifest.js';

export {
  Carrier,
  ServiceLevel,
  Facility,
  Route,
  Shipment,
  ShipmentLeg,
  TrackingEvent,
  FacilityQueue,
  WeatherEvent,
  ETAEstimate,
  DelayReason,
  GroundTruth,
  AnomalyCase,
  Job,
  ValidationRun,
  DatasetManifest,
};

/**
 * Registry of dataset entities in dependency (generation) order.
 * `idField` is the stable business key used for sorting, checksums and exports.
 * `partitioned` entities carry BASELINE/ANOMALY partition labels.
 */
export const DATASET_ENTITIES = Object.freeze([
  { name: 'carriers', entity: 'Carrier', model: Carrier, idField: 'carrierId', partitioned: false },
  {
    name: 'service_levels',
    entity: 'ServiceLevel',
    model: ServiceLevel,
    idField: 'serviceLevelId',
    partitioned: false,
  },
  {
    name: 'facilities',
    entity: 'Facility',
    model: Facility,
    idField: 'facilityId',
    partitioned: false,
  },
  { name: 'routes', entity: 'Route', model: Route, idField: 'routeId', partitioned: false },
  {
    name: 'weather_events',
    entity: 'WeatherEvent',
    model: WeatherEvent,
    idField: 'weatherEventId',
    partitioned: false,
  },
  {
    name: 'facility_queues',
    entity: 'FacilityQueue',
    model: FacilityQueue,
    idField: 'queueObservationId',
    partitioned: false,
  },
  {
    name: 'shipments',
    entity: 'Shipment',
    model: Shipment,
    idField: 'shipmentId',
    partitioned: true,
  },
  {
    name: 'shipment_legs',
    entity: 'ShipmentLeg',
    model: ShipmentLeg,
    idField: 'legId',
    partitioned: true,
  },
  {
    name: 'tracking_events',
    entity: 'TrackingEvent',
    model: TrackingEvent,
    idField: 'eventId',
    partitioned: true,
  },
  {
    name: 'eta_estimates',
    entity: 'ETAEstimate',
    model: ETAEstimate,
    idField: 'etaId',
    partitioned: true,
  },
  {
    name: 'delay_reasons',
    entity: 'DelayReason',
    model: DelayReason,
    idField: 'delayId',
    partitioned: true,
  },
  {
    name: 'ground_truth',
    entity: 'GroundTruth',
    model: GroundTruth,
    idField: 'groundTruthId',
    partitioned: true,
  },
  {
    name: 'anomaly_cases',
    entity: 'AnomalyCase',
    model: AnomalyCase,
    idField: 'anomalyId',
    partitioned: false,
  },
]);

export const entityByName = (name) => DATASET_ENTITIES.find((e) => e.name === name);

/** Create all declared indexes (idempotent). Called before bulk loads and on server start. */
export async function ensureIndexes() {
  const models = [...DATASET_ENTITIES.map((e) => e.model), Job, ValidationRun, DatasetManifest];
  for (const model of models) {
    await model.createCollection().catch((err) => {
      if (err?.codeName !== 'NamespaceExists') throw err;
    });
    await model.createIndexes();
  }
}
