import { TrackingEvent } from '../models/index.js';
import { LATE_INGESTION_THRESHOLD_MINUTES } from '../validators/temporal.validator.js';
import { latestViolationIndex } from './quality.service.js';

const SORTS = {
  occurredAt: { occurredAt: 1, eventId: 1 },
  '-occurredAt': { occurredAt: -1, eventId: -1 },
  ingestedAt: { ingestedAt: 1, eventId: 1 },
  '-ingestedAt': { ingestedAt: -1, eventId: -1 },
  eventId: { eventId: 1 },
};
const LATE_MS = LATE_INGESTION_THRESHOLD_MINUTES * 60000;

/**
 * Server-side paginated tracking-event explorer. Every row carries its ingestion lag and the
 * rule IDs the latest validation run raised for it (duplicates, sequence, lifecycle...).
 */
export async function listEvents(query) {
  const filter = {};
  for (const field of ['eventType', 'shipmentId', 'facilityId', 'partition', 'source']) {
    if (query[field] !== undefined) filter[field] = query[field];
  }
  const timeField = query.timeField === 'ingestedAt' ? 'ingestedAt' : 'occurredAt';
  if (query.from || query.to) {
    filter[timeField] = {};
    if (query.from) filter[timeField].$gte = query.from;
    if (query.to) filter[timeField].$lte = query.to;
  }
  if (query.late === true) {
    filter.$expr = { $gt: [{ $subtract: ['$ingestedAt', '$occurredAt'] }, LATE_MS] };
  }
  if (query.flagged === true) {
    const index = await latestViolationIndex();
    filter.eventId = { $in: [...index.byRecord.keys()].filter((id) => id.startsWith('EVT-')) };
  }
  const skip = (query.page - 1) * query.limit;
  const [items, total, index] = await Promise.all([
    TrackingEvent.find(filter, { _id: 0 }).sort(SORTS[query.sort]).skip(skip).limit(query.limit).lean(),
    TrackingEvent.countDocuments(filter),
    latestViolationIndex(),
  ]);
  return {
    items: items.map((e) => {
      const lagMinutes = Math.round((e.ingestedAt - e.occurredAt) / 60000);
      return {
        ...e,
        lagMinutes,
        isLateArrival: lagMinutes * 60000 > LATE_MS,
        validation: index.byRecord.get(e.eventId) ?? [],
      };
    }),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      sort: query.sort,
      lateThresholdMinutes: LATE_INGESTION_THRESHOLD_MINUTES,
      validationRunId: index.runId,
    },
  };
}
