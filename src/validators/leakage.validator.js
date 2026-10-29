import {
  computeEta,
  predictionTimes,
  selectEligibleEvents,
  toEtaDocument,
  toPredictionShipment,
} from '../services/eta.service.js';
import { canonicalJson } from '../utils/hash.js';
import { toMs } from '../utils/time.js';

const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());

/**
 * Temporal-integrity audit of every stored ETA snapshot:
 *  1. Leakage: every referenced input (event, queue observation, weather advisory) and every
 *     watermark must have been ingested by predictionAt; the snapshot may not have considered more
 *     events than were eligible.
 *  2. Reproducibility: recompute the snapshot from the database with the production engine and
 *     compare estimate, input hash, adjustments and position exactly.
 */
export function checkShipmentEtas(collector, { shipment: s, events, etas }, ref) {
  const sid = s.shipmentId;
  const eventsById = new Map(events.map((e) => [e.eventId, e]));
  const prediction = toPredictionShipment(s);
  const serviceLevel = ref.serviceLevelsById.get(s.serviceLevelId);
  const carrier = ref.carriersById.get(s.carrierId) ?? null;

  for (const eta of etas) {
    const t = toMs(eta.predictionAt);
    const base = { entityType: 'ETAEstimate', recordId: eta.etaId, shipmentId: sid };

    collector.check(
      'ETA_TIME_ORDER',
      t >= toMs(s.createdAt) &&
        t <= ref.asOfMs &&
        (toMs(eta.estimatedArrivalAt) >= t || eta.position.phase === 'DELIVERED'),
      () => ({
        ...base,
        expected: 'createdAt <= predictionAt <= asOf and estimatedArrivalAt >= predictionAt',
        actual: `predictionAt=${iso(t)} estimatedArrivalAt=${iso(eta.estimatedArrivalAt)} createdAt=${iso(s.createdAt)}`,
      }),
    );

    const a = eta.adjustments;
    const total = Math.round((toMs(eta.estimatedArrivalAt) - t) / 60000);
    collector.check(
      'ETA_ADJUSTMENT_RECONCILIATION',
      a.totalRemainingMinutes === total &&
        a.baseRemainingMinutes +
          a.queueMinutes +
          a.weatherMinutes +
          a.holdMinutes +
          a.interactionMinutes ===
          total,
      () => ({
        ...base,
        expected: `components sum to ${total} min (estimatedArrivalAt - predictionAt)`,
        actual: JSON.stringify(a),
      }),
    );

    // ---- Leakage ----
    const leaks = [];
    const wm = eta.watermark;
    for (const [field, value] of Object.entries({
      maxEventIngestedAt: wm.maxEventIngestedAt,
      maxQueueIngestedAt: wm.maxQueueIngestedAt,
      maxWeatherIngestedAt: wm.maxWeatherIngestedAt,
    })) {
      if (value && toMs(value) > t) leaks.push(`watermark.${field}=${iso(value)}`);
    }
    for (const id of eta.inputs.eventIds) {
      const e = eventsById.get(id);
      if (!e) leaks.push(`event ${id} not found`);
      else if (toMs(e.ingestedAt) > t || toMs(e.occurredAt) > t)
        leaks.push(`event ${id} ingested ${iso(e.ingestedAt)}`);
    }
    for (const id of eta.inputs.queueObservationIds) {
      const ingested = ref.queueIngestedById.get(id);
      if (ingested === undefined || ingested > t)
        leaks.push(`queue observation ${id} ingested ${iso(ingested)}`);
    }
    for (const id of eta.inputs.weatherEventIds) {
      const w = ref.weatherIndex.byId.get(id);
      if (!w || w.ingestedAt > t)
        leaks.push(`weather advisory ${id} ingested ${iso(w?.ingestedAt)}`);
    }
    const eligibleCount = selectEligibleEvents(events, t).eligible.length;
    if (wm.eventsConsidered > eligibleCount) {
      leaks.push(
        `considered ${wm.eventsConsidered} events but only ${eligibleCount} were available`,
      );
    }
    collector.check('ETA_FUTURE_DATA_LEAKAGE', leaks.length === 0, () => ({
      ...base,
      expected: `all inputs ingested <= predictionAt ${iso(t)}`,
      actual: leaks.join('; '),
      explanation: 'Snapshot depends on information that was not available at its prediction time',
    }));

    // ---- Reproducibility ----
    let recomputed = null;
    let error = null;
    try {
      recomputed = toEtaDocument(
        computeEta({
          shipment: prediction,
          predictionAt: t,
          events,
          routesById: ref.routesById,
          facilitiesById: ref.facilitiesById,
          carrier,
          serviceLevel,
          queueSource: ref.queueSource,
          weatherIndex: ref.weatherIndex,
        }),
        eta.partition,
      );
    } catch (err) {
      error = err.message;
    }
    const diffs = [];
    if (error) diffs.push(`recompute failed: ${error}`);
    else {
      if (toMs(recomputed.estimatedArrivalAt) !== toMs(eta.estimatedArrivalAt)) {
        diffs.push(
          `estimatedArrivalAt stored ${iso(eta.estimatedArrivalAt)} vs recomputed ${iso(recomputed.estimatedArrivalAt)}`,
        );
      }
      if (recomputed.inputHash !== eta.inputHash) diffs.push('inputHash differs');
      if (recomputed.configHash !== eta.configHash) diffs.push('configHash differs');
      if (canonicalJson(recomputed.adjustments) !== canonicalJson(eta.adjustments))
        diffs.push('adjustments differ');
      if (recomputed.position.phase !== eta.position.phase) diffs.push('position differs');
    }
    collector.check('ETA_REPRODUCIBILITY_MISMATCH', diffs.length === 0, () => ({
      ...base,
      expected: 'identical snapshot when recomputed from eligible stored inputs',
      actual: diffs.join('; '),
    }));
  }

  // Snapshot preservation: every scheduled prediction time has a stored snapshot.
  const stored = new Set(etas.map((e) => toMs(e.predictionAt)));
  const missing = predictionTimes(s.createdAt, ref.asOfMs, events).filter((t) => !stored.has(t));
  collector.check('ETA_SNAPSHOT_COVERAGE', missing.length === 0, () => ({
    entityType: 'Shipment',
    recordId: sid,
    shipmentId: sid,
    expected: 'a preserved snapshot for each scheduled prediction time',
    actual: `missing ${missing.map(iso).join(', ')}`,
  }));
}
