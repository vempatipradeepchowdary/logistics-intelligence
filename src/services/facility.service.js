import {
  DatasetManifest,
  DelayReason,
  Facility,
  FacilityQueue,
  Shipment,
  ShipmentLeg,
  TrackingEvent,
  WeatherEvent,
} from '../models/index.js';
import { AppError } from '../utils/appError.js';
import { cached } from '../utils/datasetCache.js';

const NO_ID = { _id: 0 };

async function snapshotTime() {
  const m = await DatasetManifest.findOne({ status: 'COMPLETED' }, { simulationWindow: 1 })
    .sort({ createdAt: -1 })
    .lean();
  return m?.simulationWindow?.asOf ? new Date(m.simulationWindow.asOf) : null;
}

/** Per-facility aggregates (volumes, queue statistics, disruption counts). Cached per dataset. */
function facilityStats() {
  return cached('facility-stats', async () => {
    const [origins, destinations, events, queues, latest, weather, delays] = await Promise.all([
      Shipment.aggregate([{ $group: { _id: '$originFacilityId', n: { $sum: 1 } } }]),
      Shipment.aggregate([{ $group: { _id: '$destinationFacilityId', n: { $sum: 1 } } }]),
      TrackingEvent.aggregate([{ $group: { _id: '$facilityId', n: { $sum: 1 } } }]),
      FacilityQueue.aggregate([
        {
          $group: {
            _id: '$facilityId',
            observations: { $sum: 1 },
            avgWait: { $avg: '$estimatedWaitMinutes' },
            maxWait: { $max: '$estimatedWaitMinutes' },
            p90: { $percentile: { input: '$estimatedWaitMinutes', p: [0.9], method: 'approximate' } },
            highOrSevere: { $sum: { $cond: [{ $in: ['$congestionLevel', ['HIGH', 'SEVERE']] }, 1, 0] } },
          },
        },
      ]),
      FacilityQueue.aggregate([
        { $sort: { facilityId: 1, observedAt: -1 } },
        { $group: { _id: '$facilityId', latest: { $first: '$$ROOT' } } },
      ]),
      WeatherEvent.aggregate([
        { $unwind: '$affectedFacilityIds' },
        { $group: { _id: '$affectedFacilityIds', n: { $sum: 1 }, maxSeverity: { $max: '$severity' } } },
      ]),
      DelayReason.aggregate([
        { $match: { isPrimary: true, reasonCode: { $in: ['FACILITY_CONGESTION', 'WEATHER_DISRUPTION'] } } },
        { $unwind: '$evidence.facilityIds' },
        { $group: { _id: '$evidence.facilityIds', n: { $sum: 1 } } },
      ]),
    ]);
    const toMap = (rows, fn = (r) => r.n) => new Map(rows.map((r) => [r._id, fn(r)]));
    return {
      origins: toMap(origins),
      destinations: toMap(destinations),
      events: toMap(events),
      queues: toMap(queues, (r) => ({
        observations: r.observations,
        avgWaitMinutes: Math.round(r.avgWait),
        p90WaitMinutes: Math.round(r.p90[0]),
        maxWaitMinutes: r.maxWait,
        congestedShare: Number((r.highOrSevere / r.observations).toFixed(4)),
      })),
      latest: toMap(latest, (r) => {
        const { _id, ...obs } = r.latest;
        return obs;
      }),
      weather: toMap(weather, (r) => ({ disruptions: r.n, maxSeverity: r.maxSeverity })),
      delays: toMap(delays),
    };
  });
}

export async function listFacilities(query) {
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.region) filter.region = query.region;
  const [facilities, stats] = await Promise.all([
    Facility.find(filter, NO_ID).sort({ facilityId: 1 }).lean(),
    facilityStats(),
  ]);
  const needle = query.q?.toLowerCase();
  const items = facilities
    .filter(
      (f) =>
        !needle ||
        f.facilityId.toLowerCase().includes(needle) ||
        f.name.toLowerCase().includes(needle) ||
        f.city.toLowerCase().includes(needle),
    )
    .map((f) => ({
      ...f,
      shipmentsOriginating: stats.origins.get(f.facilityId) ?? 0,
      shipmentsTerminating: stats.destinations.get(f.facilityId) ?? 0,
      trackingEvents: stats.events.get(f.facilityId) ?? 0,
      queue: stats.queues.get(f.facilityId) ?? null,
      latestQueueObservation: stats.latest.get(f.facilityId) ?? null,
      disruptions: stats.weather.get(f.facilityId) ?? { disruptions: 0, maxSeverity: null },
      primaryDelayAttributions: stats.delays.get(f.facilityId) ?? 0,
    }));
  return { items, meta: { total: items.length, asOf: await snapshotTime() } };
}

export async function getFacility(facilityId, { days }) {
  const facility = await Facility.findOne({ facilityId }, NO_ID).lean();
  if (!facility) throw new AppError('NOT_FOUND', `Facility ${facilityId} not found`, 404);
  const asOf = await snapshotTime();
  const from = asOf ? new Date(asOf.getTime() - days * 86400000) : new Date(0);
  const [queueHistory, recentEvents, disruptions, delayReasons, stats, parent] = await Promise.all([
    FacilityQueue.find({ facilityId, observedAt: { $gte: from } }, NO_ID).sort({ observedAt: 1 }).lean(),
    TrackingEvent.find({ facilityId }, NO_ID).sort({ occurredAt: -1 }).limit(25).lean(),
    WeatherEvent.find({ affectedFacilityIds: facilityId }, NO_ID).sort({ startAt: -1 }).limit(50).lean(),
    DelayReason.aggregate([
      { $match: { 'evidence.facilityIds': facilityId } },
      {
        $group: {
          _id: '$reasonCode',
          shipments: { $sum: 1 },
          primary: { $sum: { $cond: ['$isPrimary', 1, 0] } },
          minutes: { $sum: '$attributedMinutes' },
        },
      },
      { $sort: { shipments: -1 } },
    ]),
    facilityStats(),
    facility.parentHubId ? Facility.findOne({ facilityId: facility.parentHubId }, NO_ID).lean() : null,
  ]);
  return {
    facility,
    parentHub: parent,
    asOf,
    stats: {
      shipmentsOriginating: stats.origins.get(facilityId) ?? 0,
      shipmentsTerminating: stats.destinations.get(facilityId) ?? 0,
      trackingEvents: stats.events.get(facilityId) ?? 0,
      queue: stats.queues.get(facilityId) ?? null,
    },
    queueHistory,
    recentEvents,
    disruptions,
    delayReasons: delayReasons.map((r) => ({ reasonCode: r._id, shipments: r.shipments, primary: r.primary, attributedMinutes: r.minutes })),
  };
}

/** Shipment-leg impact per disruption window (legs whose recorded delay cites the window). */
function disruptionImpact() {
  return cached('disruption-impact', async () => {
    const rows = await ShipmentLeg.aggregate([
      { $match: { weatherEventIds: { $ne: [] } } },
      { $unwind: '$weatherEventIds' },
      {
        $group: {
          _id: '$weatherEventIds',
          legs: { $sum: 1 },
          shipments: { $addToSet: '$shipmentId' },
          weatherMinutes: { $sum: '$delayBreakdown.weatherMinutes' },
        },
      },
      { $project: { legs: 1, shipments: { $size: '$shipments' }, weatherMinutes: 1 } },
    ]).allowDiskUse(true);
    return new Map(rows.map((r) => [r._id, { legs: r.legs, shipments: r.shipments, weatherMinutes: r.weatherMinutes }]));
  });
}

const DISRUPTION_SORTS = {
  startAt: { startAt: 1, weatherEventId: 1 },
  '-startAt': { startAt: -1, weatherEventId: -1 },
  '-severity': { severity: -1, startAt: -1 },
  weatherEventId: { weatherEventId: 1 },
};

export async function listDisruptions(query) {
  const filter = {};
  if (query.weatherType) filter.weatherType = query.weatherType;
  if (query.severity) filter.severity = query.severity;
  if (query.advisoryType) filter.advisoryType = query.advisoryType;
  if (query.facilityId) filter.affectedFacilityIds = query.facilityId;
  // Window overlap with [from, to].
  if (query.from) filter.endAt = { $gte: query.from };
  if (query.to) filter.startAt = { $lte: query.to };
  const skip = (query.page - 1) * query.limit;
  const [items, total, impact] = await Promise.all([
    WeatherEvent.find(filter, NO_ID).sort(DISRUPTION_SORTS[query.sort]).skip(skip).limit(query.limit).lean(),
    WeatherEvent.countDocuments(filter),
    disruptionImpact(),
  ]);
  return {
    items: items.map((w) => ({
      ...w,
      durationMinutes: Math.round((w.endAt - w.startAt) / 60000),
      advisoryLeadMinutes: Math.round((w.startAt - w.issuedAt) / 60000),
      impact: impact.get(w.weatherEventId) ?? { legs: 0, shipments: 0, weatherMinutes: 0 },
    })),
    meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), sort: query.sort },
  };
}

/** Daily counts of active disruption windows by severity (for the timeline chart). */
export function disruptionTimeline() {
  return cached('disruption-timeline', async () => {
    const events = await WeatherEvent.find({}, { _id: 0, startAt: 1, endAt: 1, severity: 1 }).lean();
    const days = new Map();
    for (const e of events) {
      const first = Math.floor(e.startAt.getTime() / 86400000);
      const last = Math.floor((e.endAt.getTime() - 1) / 86400000);
      for (let d = first; d <= last; d += 1) {
        if (!days.has(d)) days.set(d, { date: new Date(d * 86400000).toISOString().slice(0, 10), 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
        days.get(d)[e.severity] += 1;
      }
    }
    return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  });
}

export async function getDisruption(weatherEventId) {
  const event = await WeatherEvent.findOne({ weatherEventId }, NO_ID).lean();
  if (!event) throw new AppError('NOT_FOUND', `Disruption ${weatherEventId} not found`, 404);
  const [legs, facilities, impact] = await Promise.all([
    ShipmentLeg.find({ weatherEventIds: weatherEventId }, { _id: 0, legId: 1, shipmentId: 1, fromFacilityId: 1, toFacilityId: 1, actualDepartureAt: 1, delayBreakdown: 1 })
      .sort({ shipmentId: 1 })
      .limit(100)
      .lean(),
    Facility.find({ facilityId: { $in: event.affectedFacilityIds } }, { _id: 0, facilityId: 1, name: 1, type: 1, city: 1 }).lean(),
    disruptionImpact(),
  ]);
  return {
    event,
    affectedFacilities: facilities,
    impact: impact.get(weatherEventId) ?? { legs: 0, shipments: 0, weatherMinutes: 0 },
    impactedLegs: legs,
  };
}
