import { z } from 'zod';
import {
  DELAY_CLASSES,
  DELAY_REASON_CODES,
  ETA_CONFIDENCE,
  ETA_POSITION_PHASES,
  EVENT_SOURCES,
  EVENT_TYPES,
  FACILITY_TYPES,
  ID_PATTERNS,
  PARTITIONS,
  SHIPMENT_STATUSES,
  VALIDATION_SEVERITIES,
  WEATHER_ADVISORY_TYPES,
  WEATHER_TYPES,
} from '../config/constants.js';
import { isoDate } from '../middleware/requestValidator.js';

// Request schemas for every endpoint (strict: unknown keys are rejected).

const page = z.coerce.number().int().min(1).max(100000).default(1);
const limit = z.coerce.number().int().min(1).max(200).default(25);
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const shipmentIdParams = z.object({
  id: z.string().regex(ID_PATTERNS.shipmentId, 'Expected a shipment ID like SHP-2026-000001'),
});
export const jobIdParams = z.object({
  jobId: z.string().regex(/^JOB-[A-Z]+-[a-z0-9]+-[a-f0-9]{6}$/, 'Invalid job ID'),
});
export const facilityIdParams = z.object({ id: z.string().regex(ID_PATTERNS.facilityId) });
export const disruptionIdParams = z.object({ id: z.string().regex(ID_PATTERNS.weatherEventId) });
export const etaIdParams = z.object({ id: z.string().regex(ID_PATTERNS.etaId) });

export const listShipmentsQuery = z
  .object({
    page,
    limit,
    status: z.enum(SHIPMENT_STATUSES).optional(),
    carrierId: z.string().regex(ID_PATTERNS.carrierId).optional(),
    serviceLevelId: z.string().regex(ID_PATTERNS.serviceLevelId).optional(),
    originFacilityId: z.string().regex(ID_PATTERNS.facilityId).optional(),
    destinationFacilityId: z.string().regex(ID_PATTERNS.facilityId).optional(),
    partition: z.enum(PARTITIONS).optional(),
    delayClass: z.enum(DELAY_CLASSES).optional(),
    q: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,20}$/, 'q must be a business-ID prefix')
      .optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    sort: z
      .enum([
        'createdAt',
        '-createdAt',
        'shipmentId',
        '-shipmentId',
        'promisedDeliveryAt',
        '-promisedDeliveryAt',
      ])
      .default('shipmentId'),
  })
  .strict();

export const eventsQuery = z.object({ asOf: isoDate.optional() }).strict();

export const listEventsQuery = z
  .object({
    page,
    limit,
    eventType: z.enum(EVENT_TYPES).optional(),
    source: z.enum(EVENT_SOURCES).optional(),
    shipmentId: z.string().regex(ID_PATTERNS.shipmentId).optional(),
    facilityId: z.string().regex(ID_PATTERNS.facilityId).optional(),
    partition: z.enum(PARTITIONS).optional(),
    timeField: z.enum(['occurredAt', 'ingestedAt']).default('occurredAt'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    late: bool.optional(),
    flagged: bool.optional(),
    sort: z
      .enum(['occurredAt', '-occurredAt', 'ingestedAt', '-ingestedAt', 'eventId'])
      .default('-occurredAt'),
  })
  .strict();

export const partitionQuery = z
  .object({ partition: z.enum([...PARTITIONS, 'ALL']).default('BASELINE') })
  .strict();

export const dataQualityQuery = z
  .object({
    includeViolations: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(5000).default(200),
  })
  .strict();

export const violationsQuery = z
  .object({
    page,
    limit,
    severity: z.enum(VALIDATION_SEVERITIES).optional(),
    ruleId: z
      .string()
      .regex(/^[A-Z_]{3,60}$/)
      .optional(),
    entityType: z
      .string()
      .regex(/^[A-Za-z*]{1,40}$/)
      .optional(),
    classification: z.enum(['INTENTIONAL_ANOMALY', 'UNEXPECTED']).optional(),
    q: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,40}$/)
      .optional(),
  })
  .strict();

export const facilitiesQuery = z
  .object({
    type: z.enum(FACILITY_TYPES).optional(),
    region: z
      .string()
      .regex(/^[A-Z_]{2,30}$/)
      .optional(),
    q: z
      .string()
      .regex(/^[A-Za-z0-9 .-]{1,40}$/)
      .optional(),
  })
  .strict();
export const facilityDetailQuery = z
  .object({ days: z.coerce.number().int().min(1).max(366).default(14) })
  .strict();

export const disruptionsQuery = z
  .object({
    page,
    limit,
    weatherType: z.enum(WEATHER_TYPES).optional(),
    severity: z.coerce.number().int().min(1).max(5).optional(),
    advisoryType: z.enum(WEATHER_ADVISORY_TYPES).optional(),
    facilityId: z.string().regex(ID_PATTERNS.facilityId).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    sort: z.enum(['startAt', '-startAt', '-severity', 'weatherEventId']).default('-startAt'),
  })
  .strict();

export const etasQuery = z
  .object({
    page,
    limit,
    shipmentId: z.string().regex(ID_PATTERNS.shipmentId).optional(),
    partition: z.enum(PARTITIONS).optional(),
    confidence: z.enum(ETA_CONFIDENCE).optional(),
    phase: z.enum(ETA_POSITION_PHASES).optional(),
    evaluated: bool.optional(),
    minAbsErrorMinutes: z.coerce.number().int().min(0).optional(),
    sort: z.enum(['predictionAt', '-predictionAt', '-absError', 'etaId']).default('-predictionAt'),
  })
  .strict();

export const classifiedShipmentsQuery = z
  .object({
    page,
    limit,
    partition: z.enum([...PARTITIONS, 'ALL']).default('BASELINE'),
    delayClass: z
      .string()
      .default('DELAYED')
      .transform((v) => v.split(','))
      .pipe(z.array(z.enum(DELAY_CLASSES)).min(1).max(DELAY_CLASSES.length)),
    reasonCode: z.enum(DELAY_REASON_CODES).optional(),
    carrierId: z.string().regex(ID_PATTERNS.carrierId).optional(),
    serviceLevelId: z.string().regex(ID_PATTERNS.serviceLevelId).optional(),
    status: z.enum(SHIPMENT_STATUSES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    sort: z
      .enum([
        '-delayMinutes',
        'delayMinutes',
        'promisedDeliveryAt',
        '-promisedDeliveryAt',
        'shipmentId',
      ])
      .default('-delayMinutes'),
  })
  .strict();

export const jobsQuery = z
  .object({
    type: z.enum(['GENERATE', 'VALIDATE', 'EXPORT']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const exportLabel = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'label must match ^[a-z0-9][a-z0-9-]{0,39}$');

export const exportFileParams = z.object({
  label: exportLabel,
  file: z.string().regex(/^[a-z_]+\.(csv|json)$/, 'Invalid export file name'),
});

export const generateBody = z
  .object({
    profile: z.enum(['tiny', 'small', 'full']).default('small'),
    seed: z.number().int().nonnegative().max(4294967295).optional(),
    batchSize: z.number().int().min(100).max(10000).optional(),
    reset: z.boolean().default(false),
    resume: z.boolean().default(false),
    // Optional overrides on top of the profile (validated again by the generator config schema).
    overrides: z
      .object({
        shipments: z.number().int().min(50).max(899999).optional(),
        trackingEvents: z.number().int().min(100).optional(),
        weatherEvents: z.number().int().min(10).max(99999).optional(),
        simulationDays: z.number().int().min(7).max(366).optional(),
        anomalyCasesPerVariant: z.number().int().min(0).max(50).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => !(b.reset && b.resume), { message: 'reset and resume are mutually exclusive' });

export const validateBody = z.object({ exportLabel: exportLabel.optional() }).strict();
export const exportBody = z.object({ label: exportLabel.default('latest') }).strict();
