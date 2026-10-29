import mongoose from 'mongoose';
import { WEATHER_ADVISORY_TYPES, WEATHER_TYPES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  intMinutes,
  ref,
  requiredDate,
} from './common.js';

// One document = one disruption window affecting a set of facilities.
const weatherEventSchema = new mongoose.Schema(
  {
    weatherEventId: businessId(ID_PATTERNS.weatherEventId, 'Disruption window ID (WX-2026-00001)'),
    weatherType: { type: String, enum: WEATHER_TYPES, required: true },
    severity: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    advisoryType: {
      type: String,
      enum: WEATHER_ADVISORY_TYPES,
      required: true,
      description: 'FORECAST = issued before start; NOWCAST = issued after it began',
    },
    centerFacilityId: ref(ID_PATTERNS.facilityId, 'Facility nearest the disruption center'),
    affectedFacilityIds: {
      type: [{ type: String, match: ID_PATTERNS.facilityId }],
      validate: { validator: (v) => v.length > 0, message: 'at least one affected facility' },
    },
    radiusKm: { type: Number, required: true, min: 1 },
    startAt: requiredDate('Disruption window start'),
    endAt: requiredDate('Disruption window end (exclusive)'),
    issuedAt: requiredDate('Advisory issue time'),
    ingestedAt: requiredDate('When the advisory became available to the platform'),
    expectedDelayMinutes: intMinutes('Advisory processing delay per affected facility', { min: 0 }),
    transitSlowdownPct: { type: Number, required: true, min: 0, max: 100 },
  },
  { ...datasetSchemaOptions, collection: 'weather_events' },
);

weatherEventSchema.index({ weatherEventId: 1 }, { unique: true });
weatherEventSchema.index({ affectedFacilityIds: 1, startAt: 1 });
weatherEventSchema.index({ ingestedAt: 1 });
weatherEventSchema.index({ startAt: 1 });

export const WeatherEvent = mongoose.model('WeatherEvent', weatherEventSchema);
