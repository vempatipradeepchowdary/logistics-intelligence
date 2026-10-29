import mongoose from 'mongoose';
import { ETA_CONFIDENCE, ETA_POSITION_PHASES } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  optionalDate,
  partitionField,
  ref,
  requiredDate,
} from './common.js';

const strArray = (pattern) => [{ type: String, match: pattern }];

const watermarkSchema = new mongoose.Schema(
  {
    eventsConsidered: { type: Number, required: true, min: 0 },
    lastEventId: { type: String, default: null, match: ID_PATTERNS.eventId },
    lastEventOccurredAt: optionalDate('Occurrence time of the latest eligible event'),
    maxEventIngestedAt: optionalDate(
      'Latest ingestion time among eligible events (must be <= predictionAt)',
    ),
    maxQueueIngestedAt: optionalDate('Latest ingestion time among queue observations used'),
    maxWeatherIngestedAt: optionalDate('Latest ingestion time among weather advisories used'),
  },
  { _id: false, strict: 'throw' },
);

const inputsSchema = new mongoose.Schema(
  {
    eventIds: strArray(ID_PATTERNS.eventId),
    ignoredEventIds: strArray(ID_PATTERNS.eventId),
    queueObservationIds: strArray(ID_PATTERNS.queueObservationId),
    weatherEventIds: strArray(ID_PATTERNS.weatherEventId),
    remainingFacilityIds: strArray(ID_PATTERNS.facilityId),
    carrierKnown: { type: Boolean, required: true },
  },
  { _id: false, strict: 'throw' },
);

const adjustmentsSchema = new mongoose.Schema(
  {
    baseRemainingMinutes: { type: Number, required: true },
    queueMinutes: { type: Number, required: true, min: 0 },
    weatherMinutes: { type: Number, required: true, min: 0 },
    holdMinutes: { type: Number, required: true, min: 0 },
    interactionMinutes: {
      type: Number,
      required: true,
      description: 'Delivery-wave rounding effect',
    },
    totalRemainingMinutes: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: 'throw' },
);

const positionSchema = new mongoose.Schema(
  {
    phase: { type: String, enum: ETA_POSITION_PHASES, required: true },
    routeId: ref(ID_PATTERNS.routeId, 'Route in force at prediction time'),
    stopIndex: { type: Number, default: null },
    facilityId: { type: String, default: null, match: ID_PATTERNS.facilityId },
  },
  { _id: false, strict: 'throw' },
);

// Evaluation-only: filled after the outcome is known; never read by the ETA engine.
const evaluationSchema = new mongoose.Schema(
  {
    actualArrivalAt: requiredDate('Ground-truth delivery time'),
    errorMinutes: {
      type: Number,
      required: true,
      description: 'estimated - actual (positive = late estimate)',
    },
    absErrorMinutes: { type: Number, required: true, min: 0 },
    horizonMinutes: { type: Number, required: true, description: 'actual - predictionAt' },
  },
  { _id: false, strict: 'throw' },
);

const etaEstimateSchema = new mongoose.Schema(
  {
    etaId: businessId(ID_PATTERNS.etaId, 'Snapshot ID (ETA-<shipmentId>-<timestamp>)'),
    shipmentId: ref(ID_PATTERNS.shipmentId, 'Shipment predicted'),
    partition: partitionField,
    predictionAt: requiredDate('Prediction time: information cutoff for this snapshot'),
    estimatedArrivalAt: requiredDate('Estimated delivery time'),
    algorithmVersion: { type: String, required: true },
    configHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    inputHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    confidence: { type: String, enum: ETA_CONFIDENCE, required: true },
    position: { type: positionSchema, required: true },
    watermark: { type: watermarkSchema, required: true },
    inputs: { type: inputsSchema, required: true },
    adjustments: { type: adjustmentsSchema, required: true },
    evaluation: { type: evaluationSchema, default: null },
  },
  { ...datasetSchemaOptions, collection: 'eta_estimates' },
);

etaEstimateSchema.index({ etaId: 1 }, { unique: true });
etaEstimateSchema.index({ shipmentId: 1, predictionAt: 1 }, { unique: true });
etaEstimateSchema.index({ partition: 1, 'evaluation.absErrorMinutes': 1 });

export const ETAEstimate = mongoose.model('ETAEstimate', etaEstimateSchema);
