import { rngFor } from './rng.js';
import { simulateShipment } from './shipment.generator.js';
import { finalizeEvents, planEvents } from './event.generator.js';
import { buildShipmentRecords } from './records.builder.js';
import { ANOMALY_SEQUENCE_START } from '../config/constants.js';
import { anomalyId, delayId, shipmentId as makeShipmentId } from '../utils/idGenerator.js';
import { DAY, HOUR, MINUTE } from '../utils/time.js';
import {
  computeEta,
  evaluateEta,
  toEtaDocument,
  toPredictionShipment,
} from '../services/eta.service.js';

// Controlled, explicitly labelled anomaly injection.
//
// Every anomaly lives in its own dedicated shipment (sequence range 900001+, partition ANOMALY).
// Each case starts from a clean simulated shipment and applies exactly one documented mutation,
// so no baseline record is ever touched. Expected validator rule IDs are recorded per case.

export const ANOMALY_VARIANTS = Object.freeze([
  {
    scenario: 'A_INGESTION_TIME_CONFUSION',
    variant: 'LATE_ARRIVING_EVENT',
    expected: ['TEMPORAL_LATE_INGESTION'],
  },
  {
    scenario: 'A_INGESTION_TIME_CONFUSION',
    variant: 'INGESTED_BEFORE_OCCURRED',
    expected: ['TEMPORAL_INGESTED_BEFORE_OCCURRED'],
  },
  {
    scenario: 'B_IMPOSSIBLE_ROUTE_ORDER',
    variant: 'SWAPPED_FACILITY_ORDER',
    expected: ['ROUTE_SEQUENCE_VIOLATION'],
  },
  {
    scenario: 'B_IMPOSSIBLE_ROUTE_ORDER',
    variant: 'FACILITY_NOT_ON_ROUTE',
    expected: ['ROUTE_FACILITY_NOT_ON_ROUTE'],
  },
  {
    scenario: 'B_IMPOSSIBLE_ROUTE_ORDER',
    variant: 'LEG_CHAIN_BROKEN',
    expected: ['LEG_CHAIN_CONTINUITY'],
  },
  {
    scenario: 'C_FUTURE_DATA_LEAKAGE',
    variant: 'FUTURE_EVENTS_USED',
    expected: [
      'ETA_FUTURE_DATA_LEAKAGE',
      'ETA_REPRODUCIBILITY_MISMATCH',
      'ETA_ADJUSTMENT_RECONCILIATION',
    ],
  },
  {
    scenario: 'C_FUTURE_DATA_LEAKAGE',
    variant: 'FUTURE_WEATHER_USED',
    expected: ['ETA_FUTURE_DATA_LEAKAGE', 'ETA_REPRODUCIBILITY_MISMATCH'],
  },
  {
    scenario: 'D_DELIVERED_STILL_IN_TRANSIT',
    variant: 'DELIVERED_STATUS_IN_TRANSIT',
    expected: ['SHIPMENT_STATUS_EVENT_MISMATCH'],
  },
  { scenario: 'E_DUPLICATE_EVENT', variant: 'DUPLICATE_SCAN', expected: ['EVENT_DUPLICATE'] },
  {
    scenario: 'F_INVALID_REFERENCE',
    variant: 'EVENT_UNKNOWN_FACILITY',
    expected: ['REF_INTEGRITY', 'ROUTE_FACILITY_NOT_ON_ROUTE'],
  },
  {
    scenario: 'F_INVALID_REFERENCE',
    variant: 'SHIPMENT_UNKNOWN_CARRIER',
    expected: ['REF_INTEGRITY'],
  },
  { scenario: 'F_INVALID_REFERENCE', variant: 'ORPHAN_EVENT', expected: ['REF_INTEGRITY'] },
  {
    scenario: 'G_INVALID_TIMESTAMP',
    variant: 'EVENT_BEFORE_CREATION',
    expected: ['TEMPORAL_EVENT_BEFORE_CREATION', 'TEMPORAL_MILESTONE_ORDER'],
  },
  {
    scenario: 'H_ILLEGAL_LIFECYCLE',
    variant: 'SCAN_AFTER_DELIVERY',
    expected: ['LIFECYCLE_ILLEGAL_TRANSITION'],
  },
  { scenario: 'I_MISSING_EVENT_GAP', variant: 'TRACKING_STALLED', expected: ['TRACKING_STALLED'] },
]);

export const UNKNOWN_FACILITY_ID = 'FAC-999';
export const UNKNOWN_CARRIER_ID = 'CAR-099';

const findRaw = (raw, type, facilityId) =>
  raw.find((r) => r.eventType === type && r.facilityId === facilityId);

function crossHubPair(ctx, rng) {
  for (;;) {
    const o = rng.pick(ctx.stations);
    const d = rng.pick(ctx.stations);
    if (o.facilityId !== d.facilityId && o.parentHubId !== d.parentHubId) return [o, d];
  }
}

/** Apply a variant's mutation. Returns hooks for record-level mutations and tagged raw events. */
function mutationFor(ctx, def, plan, raw) {
  const stops = plan.plannedRoute.stops.map((s) => s.facilityId);
  const tag = (r) => {
    r.tagged = true;
    return r;
  };
  const hooks = {};
  const affected = [];
  switch (def.variant) {
    case 'LATE_ARRIVING_EVENT': {
      const ev = tag(findRaw(raw, 'ARRIVED_AT_FACILITY', stops[2]));
      ev.ingestedAt = ev.occurredAt + 30 * HOUR;
      break;
    }
    case 'INGESTED_BEFORE_OCCURRED': {
      const ev = tag(findRaw(raw, 'ARRIVED_AT_FACILITY', stops[1]));
      ev.ingestedAt = ev.occurredAt - 3 * HOUR;
      break;
    }
    case 'SWAPPED_FACILITY_ORDER': {
      const a = tag(findRaw(raw, 'ARRIVED_AT_FACILITY', stops[1]));
      const b = tag(findRaw(raw, 'ARRIVED_AT_FACILITY', stops[2]));
      [a.facilityId, b.facilityId] = [b.facilityId, a.facilityId];
      break;
    }
    case 'FACILITY_NOT_ON_ROUTE': {
      const a = findRaw(raw, 'ARRIVED_AT_FACILITY', stops[1]);
      const b = findRaw(raw, 'ARRIVED_AT_FACILITY', stops[2]);
      const offRoute = ctx.facilities.find(
        (f) => f.type === 'HUB' && !stops.includes(f.facilityId),
      );
      const at = Math.round((a.occurredAt + b.occurredAt) / 2 / MINUTE) * MINUTE;
      raw.push(
        tag({
          ...a,
          ord: a.ord + 0.5,
          facilityId: offRoute.facilityId,
          occurredAt: at,
          ingestedAt: at + 5 * MINUTE,
        }),
      );
      break;
    }
    case 'LEG_CHAIN_BROKEN': {
      const offRoute = ctx.facilities.find(
        (f) => f.type === 'SORT_CENTER' && !stops.includes(f.facilityId),
      );
      hooks.legs = (legs) => {
        legs[1].fromFacilityId = offRoute.facilityId;
        affected.push({
          entityType: 'ShipmentLeg',
          recordId: legs[1].legId,
          field: 'fromFacilityId',
        });
      };
      break;
    }
    case 'FUTURE_EVENTS_USED':
    case 'FUTURE_WEATHER_USED': {
      hooks.etas = (etas, { shipment, events }) => {
        const taken = new Set(etas.map((e) => e.predictionAt.getTime()));
        const faulty = faultyEta(ctx, def.variant, plan, shipment, events, taken);
        etas.push(faulty);
        etas.sort((x, y) => x.predictionAt - y.predictionAt);
        affected.push({ entityType: 'ETAEstimate', recordId: faulty.etaId, field: 'watermark' });
      };
      break;
    }
    case 'DELIVERED_STATUS_IN_TRANSIT': {
      hooks.shipment = (s) => {
        s.status = 'IN_TRANSIT';
        s.deliveredAt = null;
        affected.push({ entityType: 'Shipment', recordId: s.shipmentId, field: 'status' });
      };
      break;
    }
    case 'DUPLICATE_SCAN': {
      const a = findRaw(raw, 'ARRIVED_AT_FACILITY', stops[1]);
      raw.push(tag({ ...a, ord: a.ord + 0.5, ingestedAt: a.ingestedAt + 7 * MINUTE }));
      break;
    }
    case 'EVENT_UNKNOWN_FACILITY': {
      tag(findRaw(raw, 'ARRIVED_AT_FACILITY', stops[2])).facilityId = UNKNOWN_FACILITY_ID;
      break;
    }
    case 'SHIPMENT_UNKNOWN_CARRIER': {
      hooks.shipment = (s) => {
        s.carrierId = UNKNOWN_CARRIER_ID;
        affected.push({ entityType: 'Shipment', recordId: s.shipmentId, field: 'carrierId' });
      };
      break;
    }
    case 'ORPHAN_EVENT': {
      for (const r of raw) r.include = r.eventType === 'PICKED_UP';
      tag(findRaw(raw, 'PICKED_UP', stops[0]));
      hooks.orphan = true;
      break;
    }
    case 'EVENT_BEFORE_CREATION': {
      const ev = tag(findRaw(raw, 'PICKED_UP', stops[0]));
      ev.occurredAt = plan.createdAt - 2 * HOUR;
      ev.ingestedAt = ev.occurredAt + 5 * MINUTE;
      break;
    }
    case 'SCAN_AFTER_DELIVERY': {
      const delivered = findRaw(raw, 'DELIVERED', stops.at(-1));
      const at = delivered.occurredAt + 6 * HOUR;
      raw.push(
        tag({
          ...delivered,
          ord: delivered.ord + 0.5,
          eventType: 'ARRIVED_AT_FACILITY',
          source: 'FACILITY_SCANNER',
          occurredAt: at,
          ingestedAt: at + 5 * MINUTE,
        }),
      );
      break;
    }
    case 'TRACKING_STALLED': {
      for (const r of raw) if (r.eventType !== 'PICKED_UP') r.include = false;
      hooks.shipment = (s) =>
        affected.push({ entityType: 'Shipment', recordId: s.shipmentId, field: 'trackingEvents' });
      break;
    }
    default:
      throw new Error(`Unknown anomaly variant ${def.variant}`);
  }
  return { hooks, affected };
}

/** A deliberately faulty ETA snapshot, computed the way a leaky implementation would. */
function faultyEta(ctx, variant, plan, shipment, events, taken) {
  const free = (ms) => {
    let t = ms;
    while (taken.has(t)) t += MINUTE;
    return t;
  };
  const serviceLevel = ctx.serviceLevelsById.get(shipment.serviceLevelId);
  const carrier = ctx.carriersById.get(shipment.carrierId) ?? null;
  const base = {
    shipment: toPredictionShipment(shipment),
    events,
    routesById: ctx.routeIndex.byId,
    facilitiesById: ctx.facilitiesById,
    carrier,
    serviceLevel,
    queueSource: ctx.queueModel.source,
    weatherIndex: ctx.weatherIndex,
  };
  const actual = plan.deliveredAt <= ctx.asOfMs ? plan.deliveredAt : null;
  if (variant === 'FUTURE_EVENTS_USED') {
    const t = free(plan.pickupAt + 3 * HOUR + 7 * MINUTE);
    // BUG BEING SIMULATED: evaluating with a cutoff 30h in the future, then stamping the past time.
    const leaked = computeEta({ ...base, predictionAt: t + 30 * HOUR });
    const doc = toEtaDocument(
      { ...leaked, predictionAt: t, estimatedArrivalAt: Math.max(leaked.estimatedArrivalAt, t) },
      'ANOMALY',
    );
    doc.evaluation = evaluateEta(doc.estimatedArrivalAt, doc.predictionAt, actual);
    return doc;
  }
  const t = free(plan.pickupAt + 4 * HOUR + 11 * MINUTE);
  const honest = computeEta({ ...base, predictionAt: t });
  // BUG BEING SIMULATED: joining a weather advisory that was only published later.
  const future = ctx.weatherEvents.find((w) => w.ingestedAt.getTime() > t + HOUR);
  const leaked = {
    ...honest,
    estimatedArrivalAt: honest.estimatedArrivalAt + future.expectedDelayMinutes * MINUTE,
    watermark: { ...honest.watermark, maxWeatherIngestedAt: future.ingestedAt.getTime() },
    inputs: {
      ...honest.inputs,
      weatherEventIds: [...honest.inputs.weatherEventIds, future.weatherEventId].sort(),
    },
    adjustments: {
      ...honest.adjustments,
      weatherMinutes: honest.adjustments.weatherMinutes + future.expectedDelayMinutes,
      totalRemainingMinutes: honest.adjustments.totalRemainingMinutes + future.expectedDelayMinutes,
    },
  };
  const doc = toEtaDocument(leaked, 'ANOMALY');
  doc.evaluation = evaluateEta(doc.estimatedArrivalAt, doc.predictionAt, actual);
  return doc;
}

/**
 * Build all anomaly cases. Returns records grouped by collection plus AnomalyCase labels.
 */
export function generateAnomalies(ctx) {
  const perVariant = ctx.config.anomalyCasesPerVariant;
  const out = {
    shipments: [],
    legs: [],
    events: [],
    etas: [],
    groundTruth: [],
    delays: [],
    cases: [],
  };
  let delaySeq = ANOMALY_SEQUENCE_START;
  const nextDelayId = () => delayId(ctx.year, delaySeq++);
  let index = 0;
  for (const def of ANOMALY_VARIANTS) {
    for (let c = 0; c < perVariant; c += 1) {
      const seq = ANOMALY_SEQUENCE_START + index;
      const rng = rngFor(ctx.seed, 'anomaly', seq);
      const [origin, destination] = crossHubPair(ctx, rng);
      const daysBack = def.variant === 'TRACKING_STALLED' ? 12 : 20;
      const plan = simulateShipment(ctx, seq, {
        createdAt: ctx.asOfMs - daysBack * DAY + index * 37 * MINUTE,
        serviceLevelId: 'SL-STANDARD',
        originFacilityId: origin.facilityId,
        destinationFacilityId: destination.facilityId,
        fates: { neverPickedUp: false, damaged: false, attemptFailed: false },
        allowReroute: false,
      });
      const { raw } = planEvents(ctx, plan);
      for (const r of raw) if (r.optional === 'ARRIVAL') r.include = true; // full scan coverage
      const { hooks, affected } = mutationFor(ctx, def, plan, raw);
      const finalized = finalizeEvents(raw, plan.shipmentId, 'ANOMALY');
      const eventDocs = finalized.map((f) => f.doc);
      for (const f of finalized) {
        if (f.raw.tagged)
          affected.push({ entityType: 'TrackingEvent', recordId: f.doc.eventId, field: null });
      }
      if (!hooks.orphan) {
        const records = buildShipmentRecords(ctx, plan, eventDocs, {
          partition: 'ANOMALY',
          nextDelayId,
          mutate: hooks,
        });
        out.shipments.push(records.shipment);
        out.legs.push(...records.legs);
        out.etas.push(...records.etas);
        out.groundTruth.push(records.groundTruth);
        out.delays.push(...records.delays);
      }
      out.events.push(...eventDocs);
      index += 1;
      out.cases.push({
        anomalyId: anomalyId(ctx.year, index),
        scenario: def.scenario,
        variant: def.variant,
        shipmentId: makeShipmentId(ctx.year, seq),
        affectedRecords: affected,
        description: DESCRIPTIONS[def.variant],
        expectedRuleIds: def.expected,
        expectedOutcome: 'DETECTED',
      });
    }
  }
  return out;
}

const DESCRIPTIONS = {
  LATE_ARRIVING_EVENT:
    'Hub arrival scan ingested 30h after it occurred (late-arriving event). Historical ETAs between occurrence and ingestion must not use it.',
  INGESTED_BEFORE_OCCURRED:
    'Arrival scan whose ingestion time is 3h before its occurrence time (clock skew / impossible timestamp).',
  SWAPPED_FACILITY_ORDER:
    'Arrival scans at the origin hub and destination hub have their facilities swapped, so the shipment appears to visit the route out of order.',
  FACILITY_NOT_ON_ROUTE: 'An arrival scan at a hub that is not on the planned or current route.',
  LEG_CHAIN_BROKEN:
    'Leg 2 starts at a facility different from where leg 1 ended (discontinuous leg chain).',
  FUTURE_EVENTS_USED:
    'ETA snapshot computed with a cutoff 30h after its recorded prediction time (uses events not yet ingested).',
  FUTURE_WEATHER_USED:
    'ETA snapshot that applies a weather advisory published after its prediction time.',
  DELIVERED_STATUS_IN_TRANSIT:
    'Shipment has a valid DELIVERED event but its recorded status remains IN_TRANSIT and deliveredAt is empty.',
  DUPLICATE_SCAN: 'The same arrival scan is ingested twice under two event IDs.',
  EVENT_UNKNOWN_FACILITY: 'Tracking event references facility FAC-999, which does not exist.',
  SHIPMENT_UNKNOWN_CARRIER: 'Shipment references carrier CAR-099, which does not exist.',
  ORPHAN_EVENT: 'Tracking event whose shipment (and leg) does not exist.',
  EVENT_BEFORE_CREATION: 'Pickup scan timestamped 2h before the shipment was created.',
  SCAN_AFTER_DELIVERY:
    'A facility arrival scan 6h after the DELIVERED event (DELIVERED is terminal).',
  TRACKING_STALLED:
    'Shipment picked up 12 days before the snapshot with no further scans (missing-event gap).',
};
