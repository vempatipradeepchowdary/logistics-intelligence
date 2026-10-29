import mongoose from 'mongoose';
import { DISTANCE_ZONES, ROUTE_TYPES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  intMinutes,
  ref,
  requiredDate,
} from './common.js';

// Stops and legs are embedded: they are small, bounded, and versioned together with the route.
const stopSchema = new mongoose.Schema(
  {
    sequence: { type: Number, required: true, min: 0 },
    facilityId: ref(ID_PATTERNS.facilityId, 'Stop facility'),
  },
  { _id: false, strict: 'throw' },
);

const routeLegSchema = new mongoose.Schema(
  {
    sequence: { type: Number, required: true, min: 1 },
    fromFacilityId: ref(ID_PATTERNS.facilityId, 'Leg origin facility'),
    toFacilityId: ref(ID_PATTERNS.facilityId, 'Leg destination facility'),
    distanceKm: { type: Number, required: true, min: 1 },
    plannedGroundMinutes: intMinutes('Planned ground transit minutes', { min: 1 }),
    plannedAirMinutes: {
      type: Number,
      default: null,
      min: 1,
      description: 'Planned air transit minutes (null when the lane is not air-eligible)',
    },
  },
  { _id: false, strict: 'throw' },
);

const routeSchema = new mongoose.Schema(
  {
    routeId: businessId(ID_PATTERNS.routeId, 'Route business ID (RTE-00001)'),
    version: { type: Number, required: true, min: 1, immutable: true },
    routeType: { type: String, enum: ROUTE_TYPES, required: true },
    primaryRouteId: ref(ID_PATTERNS.routeId, 'For ALTERNATE routes, the primary route replaced', {
      required: false,
    }),
    originFacilityId: ref(ID_PATTERNS.facilityId, 'Origin delivery station'),
    destinationFacilityId: ref(ID_PATTERNS.facilityId, 'Destination delivery station'),
    stops: {
      type: [stopSchema],
      validate: { validator: (v) => v.length >= 2, message: 'route needs at least two stops' },
    },
    legs: {
      type: [routeLegSchema],
      validate: { validator: (v) => v.length >= 1, message: 'route needs at least one leg' },
    },
    totalDistanceKm: { type: Number, required: true, min: 1 },
    distanceZone: { type: String, enum: DISTANCE_ZONES, required: true },
    effectiveFrom: requiredDate('Version effective-from time'),
  },
  { ...datasetSchemaOptions, collection: 'routes' },
);

routeSchema.index({ routeId: 1 }, { unique: true });
routeSchema.index({ routeId: 1, version: 1 }, { unique: true });
routeSchema.index(
  { originFacilityId: 1, destinationFacilityId: 1, routeType: 1 },
  { unique: true },
);

export const Route = mongoose.model('Route', routeSchema);
