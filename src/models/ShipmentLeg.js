import mongoose from 'mongoose';
import { LEG_STATUSES, TRANSPORT_MODES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  intMinutes,
  optionalDate,
  partitionField,
  ref,
} from './common.js';

const delayBreakdownSchema = new mongoose.Schema(
  {
    queueMinutes: intMinutes('Facility queue delay at leg origin', { min: 0 }),
    weatherMinutes: intMinutes('Weather delay (dwell + transit)', { min: 0 }),
    carrierMinutes: intMinutes('Carrier performance deviation (can be negative)'),
  },
  { _id: false, strict: 'throw' },
);

const shipmentLegSchema = new mongoose.Schema(
  {
    legId: businessId(ID_PATTERNS.legId, 'Leg business ID (LEG-<shipmentId>-01)'),
    shipmentId: ref(ID_PATTERNS.shipmentId, 'Owning shipment'),
    partition: partitionField,
    sequence: { type: Number, required: true, min: 1, max: 99 },
    routeId: ref(ID_PATTERNS.routeId, 'Route this leg belongs to'),
    routeLegSequence: { type: Number, required: true, min: 1 },
    fromFacilityId: ref(ID_PATTERNS.facilityId, 'Leg origin'),
    toFacilityId: ref(ID_PATTERNS.facilityId, 'Leg destination'),
    transportMode: { type: String, enum: TRANSPORT_MODES, required: true },
    status: { type: String, enum: LEG_STATUSES, required: true },
    distanceKm: { type: Number, required: true, min: 1 },
    plannedDwellMinutes: intMinutes('Planned processing at leg origin', { min: 0 }),
    plannedTransitMinutes: intMinutes('Planned linehaul minutes', { min: 1 }),
    actualStartAt: optionalDate('Arrival at the leg origin (pickup for leg 1)'),
    actualDepartureAt: optionalDate('Departure from leg origin'),
    actualArrivalAt: optionalDate('Arrival at leg destination'),
    actualDwellMinutes: { type: Number, default: null },
    actualTransitMinutes: { type: Number, default: null },
    delayBreakdown: { type: delayBreakdownSchema, default: null },
    weatherEventIds: [{ type: String, match: ID_PATTERNS.weatherEventId }],
    cancelledAt: optionalDate('Set when a reroute cancels this planned leg'),
  },
  { ...datasetSchemaOptions, collection: 'shipment_legs' },
);

shipmentLegSchema.index({ legId: 1 }, { unique: true });
shipmentLegSchema.index({ shipmentId: 1, sequence: 1 }, { unique: true });
shipmentLegSchema.index({ fromFacilityId: 1, actualDepartureAt: 1 });
shipmentLegSchema.index({ weatherEventIds: 1 });

export const ShipmentLeg = mongoose.model('ShipmentLeg', shipmentLegSchema);
