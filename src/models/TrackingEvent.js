import mongoose from 'mongoose';
import {
  EVENT_SOURCES,
  EVENT_TYPES,
  EXCEPTION_CODES,
  ROUTE_CHANGE_REASONS,
} from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  partitionField,
  ref,
  requiredDate,
} from './common.js';

const routeChangeDetailSchema = new mongoose.Schema(
  {
    fromRouteId: ref(ID_PATTERNS.routeId, 'Previous route'),
    toRouteId: ref(ID_PATTERNS.routeId, 'New route'),
    reason: { type: String, enum: ROUTE_CHANGE_REASONS, required: true },
  },
  { _id: false, strict: 'throw' },
);

// High-volume, append-only collection. Events are never updated after insert.
const trackingEventSchema = new mongoose.Schema(
  {
    eventId: businessId(ID_PATTERNS.eventId, 'Event business ID (EVT-<shipmentId>-000001)'),
    shipmentId: ref(ID_PATTERNS.shipmentId, 'Owning shipment'),
    partition: partitionField,
    legId: ref(ID_PATTERNS.legId, 'Shipment leg the event belongs to'),
    sequence: {
      type: Number,
      required: true,
      min: 1,
      description: 'Per-shipment order of occurrence',
    },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    facilityId: ref(ID_PATTERNS.facilityId, 'Facility where the event happened'),
    occurredAt: requiredDate('Event time: when it physically happened'),
    ingestedAt: requiredDate('Ingestion time: when the platform received it'),
    source: { type: String, enum: EVENT_SOURCES, required: true },
    exceptionCode: { type: String, enum: [...EXCEPTION_CODES, null], default: null },
    routeChange: { type: routeChangeDetailSchema, default: null },
  },
  { ...datasetSchemaOptions, collection: 'tracking_events' },
);

trackingEventSchema.index({ eventId: 1 }, { unique: true });
trackingEventSchema.index({ shipmentId: 1, sequence: 1 }, { unique: true });
trackingEventSchema.index({ shipmentId: 1, occurredAt: 1 });
trackingEventSchema.index({ facilityId: 1, occurredAt: 1 });
trackingEventSchema.index({ eventType: 1, occurredAt: 1 });
trackingEventSchema.index({ occurredAt: 1 });
trackingEventSchema.index({ ingestedAt: 1 });

export const TrackingEvent = mongoose.model('TrackingEvent', trackingEventSchema);
