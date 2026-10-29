import mongoose from 'mongoose';
import { DISTANCE_ZONES, ROUTE_CHANGE_REASONS, SHIPMENT_STATUSES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  intMinutes,
  optionalDate,
  partitionField,
  ref,
  requiredDate,
} from './common.js';

const lastMileSchema = new mongoose.Schema(
  {
    arrivedAtStationAt: optionalDate('Arrival at destination delivery station'),
    readyAt: optionalDate('Station processing complete'),
    plannedDwellMinutes: intMinutes('Planned station processing', { min: 0 }),
    queueMinutes: intMinutes('Queue delay at destination station', { min: 0 }),
    weatherMinutes: intMinutes('Weather delay at destination station', { min: 0 }),
    weatherEventIds: [{ type: String, match: ID_PATTERNS.weatherEventId }],
    firstOutForDeliveryAt: optionalDate('First out-for-delivery time'),
    attemptFailed: { type: Boolean, required: true },
    attemptDelayMinutes: intMinutes('Extra minutes caused by a failed delivery attempt', {
      min: 0,
    }),
  },
  { _id: false, strict: 'throw' },
);

const routeChangeSchema = new mongoose.Schema(
  {
    occurredAt: requiredDate('When the reroute decision was made'),
    atFacilityId: ref(ID_PATTERNS.facilityId, 'Facility where the reroute happened'),
    reason: { type: String, enum: ROUTE_CHANGE_REASONS, required: true },
    fromRouteId: ref(ID_PATTERNS.routeId, 'Superseded route'),
    toRouteId: ref(ID_PATTERNS.routeId, 'Replacement route'),
    extraPlannedMinutes: intMinutes('Planned-time difference new vs old remaining path'),
  },
  { _id: false, strict: 'throw' },
);

const shipmentSchema = new mongoose.Schema(
  {
    shipmentId: businessId(ID_PATTERNS.shipmentId, 'Shipment business ID (SHP-2026-000001)'),
    sequence: { type: Number, required: true, min: 1, immutable: true },
    partition: partitionField,
    carrierId: ref(ID_PATTERNS.carrierId, 'Assigned carrier'),
    serviceLevelId: ref(ID_PATTERNS.serviceLevelId, 'Contracted service level'),
    originFacilityId: ref(ID_PATTERNS.facilityId, 'Origin delivery station'),
    destinationFacilityId: ref(ID_PATTERNS.facilityId, 'Destination delivery station'),
    plannedRouteId: ref(ID_PATTERNS.routeId, 'Route planned at creation'),
    currentRouteId: ref(ID_PATTERNS.routeId, 'Route currently in force (differs after a reroute)'),
    distanceZone: { type: String, enum: DISTANCE_ZONES, required: true },
    createdAt: requiredDate('Business creation (label/tender) time - not a record timestamp'),
    plannedPickupAt: requiredDate('Planned pickup time from the service-level cutoff rule'),
    promisedDeliveryAt: requiredDate('SLA delivery deadline'),
    pickedUpAt: optionalDate('Observed pickup (PICKED_UP event occurrence)'),
    deliveredAt: optionalDate('Observed delivery (DELIVERED event occurrence)'),
    status: {
      type: String,
      enum: SHIPMENT_STATUSES,
      required: true,
      description: 'Operational status as recorded by the system at dataAsOf',
    },
    statusUpdatedAt: optionalDate('Occurrence time of the event that set the status'),
    weightKg: { type: Number, required: true, min: 0.1, max: 1000 },
    pieces: { type: Number, required: true, min: 1, max: 50 },
    routeChange: { type: routeChangeSchema, default: null },
    lastMile: { type: lastMileSchema, default: null },
    dataAsOf: requiredDate('Snapshot time of the dataset'),
  },
  { ...datasetSchemaOptions, collection: 'shipments' },
);

shipmentSchema.index({ shipmentId: 1 }, { unique: true });
shipmentSchema.index({ partition: 1, shipmentId: 1 });
shipmentSchema.index({ status: 1, shipmentId: 1 });
shipmentSchema.index({ carrierId: 1, createdAt: 1 });
shipmentSchema.index({ serviceLevelId: 1, createdAt: 1 });
shipmentSchema.index({ originFacilityId: 1 });
shipmentSchema.index({ destinationFacilityId: 1 });
shipmentSchema.index({ createdAt: 1 });

export const Shipment = mongoose.model('Shipment', shipmentSchema);
