import mongoose from 'mongoose';
import { CONGESTION_LEVELS } from '../config/constants.js';
import {
  businessId,
  datasetSchemaOptions,
  ID_PATTERNS,
  intMinutes,
  ref,
  requiredDate,
} from './common.js';

const facilityQueueSchema = new mongoose.Schema(
  {
    queueObservationId: businessId(
      ID_PATTERNS.queueObservationId,
      'Observation ID (FQ-<facility>-<ts>)',
    ),
    facilityId: ref(ID_PATTERNS.facilityId, 'Observed facility'),
    observedAt: requiredDate('Start of the observed 4-hour window'),
    ingestedAt: requiredDate('When the observation became available to the platform'),
    windowMinutes: intMinutes('Observation window length', { min: 1 }),
    queueLength: { type: Number, required: true, min: 0 },
    throughputPerHour: { type: Number, required: true, min: 0 },
    utilizationPct: { type: Number, required: true, min: 0, max: 200 },
    estimatedWaitMinutes: intMinutes('Observed total wait (queue + weather surge)', { min: 0 }),
    baselineWaitMinutes: intMinutes('Facility normal wait', { min: 0 }),
    congestionLevel: { type: String, enum: CONGESTION_LEVELS, required: true },
    activeWeatherEventIds: [{ type: String, match: ID_PATTERNS.weatherEventId }],
  },
  { ...datasetSchemaOptions, collection: 'facility_queues' },
);

facilityQueueSchema.index({ queueObservationId: 1 }, { unique: true });
facilityQueueSchema.index({ facilityId: 1, observedAt: 1 }, { unique: true });
facilityQueueSchema.index({ ingestedAt: 1 });

export const FacilityQueue = mongoose.model('FacilityQueue', facilityQueueSchema);
