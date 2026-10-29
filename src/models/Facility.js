import mongoose from 'mongoose';
import { FACILITY_TYPES } from '../config/constants.js';
import { businessId, datasetSchemaOptions, ID_PATTERNS, intMinutes, ref } from './common.js';

const facilitySchema = new mongoose.Schema(
  {
    facilityId: businessId(ID_PATTERNS.facilityId, 'Facility business ID (FAC-001)'),
    name: { type: String, required: true },
    type: { type: String, enum: FACILITY_TYPES, required: true },
    city: { type: String, required: true },
    stateCode: { type: String, required: true, match: /^[A-Z]{2}$/ },
    region: { type: String, required: true },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    timezone: {
      type: String,
      required: true,
      description: 'IANA zone (informational; all times stored UTC)',
    },
    parentHubId: ref(ID_PATTERNS.facilityId, 'Hub this facility feeds (null for hubs)', {
      required: false,
    }),
    capacityPerHour: { type: Number, required: true, min: 1 },
    baseProcessingMinutes: intMinutes(
      'Planned processing dwell before service-level handling factor',
      {
        min: 1,
      },
    ),
    baselineQueueWaitMinutes: intMinutes(
      'Normal queue wait; observations above it count as congestion',
      {
        min: 0,
      },
    ),
    operatingStatus: { type: String, enum: ['ACTIVE'], required: true },
  },
  { ...datasetSchemaOptions, collection: 'facilities' },
);

facilitySchema.index({ facilityId: 1 }, { unique: true });
facilitySchema.index({ type: 1, region: 1 });

export const Facility = mongoose.model('Facility', facilitySchema);
