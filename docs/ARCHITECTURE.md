# Architecture & Design Decisions

## 1. Component view

```mermaid
flowchart LR
  subgraph Domain["Domain core (pure, deterministic)"]
    RNG[rng.js<br/>keyed sub-streams]
    SLA[sla.js]
    LC[lifecycle.js<br/>state machine]
    NET[network.js<br/>planned durations]
    OPS[operations.js<br/>weather + delivery waves]
    QM[queueModel.js]
  end
  subgraph Gen["Generator"]
    MD[masterData] --> DIS[disruption] --> CAL[calibration pass 1] --> SIM[shipment sim] --> EVT[event emission] --> REC[records.builder] --> ANM[anomaly injector]
  end
  ETA[eta.service.js<br/>rule engine]
  VAL[validation.service.js<br/>+ validators/*]
  EXP[export.service.js]
  API[Express API] -->|fork| W[jobs/worker.js]
  W --> Gen & VAL & EXP
  Gen --> DB[(MongoDB)]
  REC --> ETA
  VAL --> ETA
  VAL --> DB
  EXP --> DB
  EXP --> FS[(exports/)]
  Domain --- Gen & ETA & VAL
```

* **One rule set, three consumers.** SLA deadlines, planned durations, the lifecycle state machine,
  the delivery-wave rule and the queue/weather model live in `src/domain/` and are imported by the
  simulator, the ETA engine *and* the validator. The validator therefore recomputes derived values
  with exactly the logic that produced them; any divergence is a real defect.
* **Long work never runs in the API process.** Generate / validate / export jobs are persisted in
  the `jobs` collection and executed by a forked worker (`src/jobs/worker.js`). A partial unique
  index on `jobs.activeLock` guarantees at most one active data job (bounded concurrency, HTTP 409
  otherwise). Workers heart-beat every 10 s; on server start, jobs silent for > 60 s are marked
  FAILED and their lock released.

## 2. Entity relationships

```mermaid
erDiagram
  CARRIER ||--o{ SHIPMENT : carries
  SERVICE_LEVEL ||--o{ SHIPMENT : "contracted for"
  SERVICE_LEVEL }o--o{ CARRIER : "supportedServiceLevelIds"
  FACILITY ||--o{ FACILITY : "parentHubId"
  FACILITY ||--o{ ROUTE : "stops / legs (embedded)"
  ROUTE ||--o{ ROUTE : "primaryRouteId (alternate)"
  ROUTE ||--o{ SHIPMENT : "plannedRouteId / currentRouteId"
  SHIPMENT ||--|{ SHIPMENT_LEG : "shipmentId"
  ROUTE ||--o{ SHIPMENT_LEG : routeId
  SHIPMENT ||--o{ TRACKING_EVENT : shipmentId
  SHIPMENT_LEG ||--o{ TRACKING_EVENT : legId
  FACILITY ||--o{ TRACKING_EVENT : facilityId
  FACILITY ||--o{ FACILITY_QUEUE : facilityId
  FACILITY }o--o{ WEATHER_EVENT : affectedFacilityIds
  SHIPMENT ||--o{ ETA_ESTIMATE : shipmentId
  SHIPMENT ||--|| GROUND_TRUTH : shipmentId
  SHIPMENT ||--o{ DELAY_REASON : shipmentId
  SHIPMENT ||--o{ ANOMALY_CASE : "labelled by"
```

**Embedding vs. separate collections**

| Data | Decision | Reason |
|---|---|---|
| Route stops & route legs | embedded in `routes` | small, bounded, always read and versioned with the route (`routeId`+`version` unique) |
| Shipment `routeChange`, `lastMile` | embedded subdocuments | 1:1 with the shipment, written once |
| Shipment legs | separate `shipment_legs` | independently queried by facility/time, own lifecycle (PLANNED -> COMPLETED / CANCELLED) |
| Tracking events | separate `tracking_events` | highest volume (300k), append-only, indexed by `(shipmentId, sequence)`, `(shipmentId, occurredAt)`, `(facilityId, occurredAt)`, `ingestedAt` |
| ETA snapshots | separate `eta_estimates` | immutable history, one document per `(shipmentId, predictionAt)` (unique) |
| Ground truth | separate `ground_truth` | evaluation labels kept physically apart from prediction inputs |
| Delay reasons | separate `delay_reasons` | one per (shipment, reason) with exactly one primary |

**Referential integrity.** MongoDB has no foreign keys, so integrity is enforced in three layers:
(1) strict Mongoose schemas with business-ID format validation on every reference field;
(2) unique and compound unique indexes; (3) the validator's `REF_INTEGRITY` rule, which checks every
reference (including orphan detection for children whose parent does not exist) on every run.

## 3. Time semantics

| Time | Field(s) | Meaning |
|---|---|---|
| Event time | `tracking_events.occurredAt` | when the scan physically happened |
| Ingestion time | `tracking_events.ingestedAt`, `facility_queues.ingestedAt`, `weather_events.ingestedAt` | when the platform received the record |
| Prediction time | `eta_estimates.predictionAt` | information cut-off of an ETA snapshot |
| Delivery time | `shipments.deliveredAt` (observed), `ground_truth.actualDeliveredAt` (truth) | when the parcel was delivered |
| Snapshot time | `shipments.dataAsOf`, manifest `simulationWindow.asOf` | the dataset's "now"; nothing occurs or is ingested after it |

**Late-arriving event policy.** Events keep their true `occurredAt`; they become *usable* only from
their `ingestedAt`. An ETA at time *t* uses an event iff `ingestedAt <= t AND occurredAt <= t`.
Ingestion lag above 6 h is flagged (`TEMPORAL_LATE_INGESTION`, WARNING) but the event is retained.
`ingestedAt < occurredAt` is invalid (`TEMPORAL_INGESTED_BEFORE_OCCURRED`, ERROR). The baseline
contains realistic lags (scanner 1-10 min, driver app 1-15 min, EDI batches 15-120 min, delayed scans
1-5 h), all below the 6 h threshold.

## 4. Synthetic data generation

* **Determinism.** `rngFor(seed, namespace, key)` hashes `(seed, namespace, key)` with cyrb53 into a
  mulberry32 stream. Every record family draws from its own stream (`shipment/42`, `events/42`,
  `queue/FAC-007/bucket`...), so a record never depends on how many numbers other records consumed.
  No `Date.now()` or `Math.random()` is used for dataset content. Mongo `_id`s are excluded from
  checksums and exports.
* **Order.** master data -> disruption windows -> facility queue observations -> calibration
  (pass 1) -> shipments in batches (shipment -> legs -> events -> ETA snapshots -> ground truth ->
  delay reasons) -> anomaly partition -> manifest (counts, target check, checksums, edge-case
  catalogue).
* **Physical simulation, then observation.** `shipment.generator.js` produces the true timeline
  (pickup, every leg's dwell and transit with queue / weather / carrier components, reroutes, last
  mile, failed attempts, damage holds). `event.generator.js` turns scan opportunities into observed
  events with ingestion lag and missed scans, and drops anything not ingested by the snapshot time.
  Observed shipment fields (status, pickedUpAt, deliveredAt) are *derived from the observed events*.
* **Exact 300,000 events.** Pass 1 simulates every shipment and counts its natural events. The
  difference to the target is distributed one optional departure scan at a time, round-robin over a
  seeded permutation of shipments (`calibrateEventCounts`). The manifest records the natural count and
  the adjustment (e.g. tiny: 3,530 natural -> +70). This is documented calibration of an optional scan
  type, not padding.
* **Resumability.** The manifest stores a checkpoint after each committed batch. `--resume` deletes
  any partially written batch, recomputes the (cheap, deterministic) calibration and continues; the
  acceptance test interrupts a run mid-way and proves the resumed dataset has the same checksum as an
  uninterrupted one.

### Realism levers

| Lever | Implementation |
|---|---|
| Network | 14 hubs, 16 sort centers, 70 delivery stations in 50 US metros; stations feed their nearest hub; 4,830 primary + 4,496 alternate routes (9,326 total) |
| Demand | origin/destination weighted by city demand; business-hour tender profile |
| Service mix | Express 14%, Priority 24%, Standard 46%, Economy 16%; zone-based commitments |
| Carriers | 8 fictional carriers with transit factor, variability, scan compliance, EDI share, pickup reliability |
| Disruptions | regional weather climatology, severity 1-5, 70% forecasts issued 6-72 h ahead, 30% nowcasts |
| Queues | 4-hour buckets with type-specific peak hours, Monday surge, 5% congestion spikes, weather surge |
| Exceptions | 0.3% never picked up, 0.4% damaged holds, 3% failed first delivery attempt |
| Reroutes | at the origin hub when a known severe advisory covers the downstream hub (70%), or 1.2% capacity reroutes |

## 5. ETA engine (`eta-rules-v1.0.0`)

Transparent and rule-based; **not** a trained model.

```
ETA = predictionAt + base remaining duration + Σ facility adjustments + hold adjustment
```

1. **Eligibility.** Keep events with `ingestedAt <= t` and `occurredAt <= t`; drop exact duplicates
   (same type, facility, occurrence time).
2. **Position.** Replay eligible events along the planned route; an eligible `ROUTE_CHANGED` event
   switches to its target route. Backward or off-route scans are ignored (and lower confidence).
3. **Base remaining duration.** From the position, walk the remaining stops using planned dwell
   (`facility.baseProcessingMinutes x serviceLevel.handlingFactor`) and planned transit (ground or air
   per service level) x the carrier's configured `transitTimeFactor`. Without a departure scan the
   parcel is assumed to have left on its planned schedule (dead reckoning) - missing departure scans
   are common. Last mile follows the shared delivery-wave rule (08:00 wave, on-arrival dispatch until
   12:00, else next day) plus an expected 270 min on the van.
4. **Adjustments, without double counting.** For each remaining facility, `max(queue, weather)`:
   * queue = latest observation *ingested by t* (within 8 h) above baseline, only for facilities
     reached within 6 h;
   * weather = the strongest advisory *ingested by t* whose window covers the expected arrival;
   * each weather window is applied at most once per shipment. Queue observations already include
     weather surge, hence `max` rather than sum.
5. **Hold.** An open exception adds a 24 h hold. A failed attempt moves delivery to the next wave.
6. **Audit trail.** Each snapshot stores the watermark (events considered, last event, max ingestion
   time per source), the exact input IDs, the adjustment breakdown (which reconciles to the total),
   `configHash` and an `inputHash` over the eligible inputs. Evaluation (`actual - estimate`) is a
   separate sub-document added afterwards and is never read by the engine.

**Prediction schedule.** `createdAt + 1 h, 24 h, 48 h, 96 h` and the snapshot time, stopping once a
`DELIVERED` event has been *ingested*. Snapshots are immutable; new predictions are new documents.

**What the engine is allowed to see.** `toPredictionShipment()` passes only creation-time facts
(IDs, origin/destination, planned route, createdAt, plannedPickupAt, promisedDeliveryAt). Status,
deliveredAt, currentRouteId (a reroute is known only through an eligible event) and ground truth are
never inputs; a unit test proves mutating them does not change the estimate.

## 6. Ground truth and delay classification (`gt-rules-v1.0.0`)

Rules are evaluated in order (see `src/services/delay.service.js`):

| # | Condition | Label |
|---|---|---|
| R1 | delivered by asOf | `ON_TIME` if `deliveredAt <= promisedDeliveryAt`, else `DELAYED` |
| R2 | open DAMAGED exception | `OPERATIONAL_EXCEPTION` |
| R3 | no pickup scan > 24 h after tender | `INSUFFICIENT_DATA` (we do not invent an outcome) |
| R4 | asOf past the deadline | `DELAYED` (overdue) |
| R5 | no ETA available | `INSUFFICIENT_DATA` |
| R6 | ETA at asOf > deadline - service buffer | `AT_RISK` |
| R7 | otherwise | `ON_TRACK` |

`deliveryOutcome` (DELIVERED / NOT_DELIVERED) is reported alongside. Delay attribution
(`delay-attribution-v1.0.0`) sums recorded components: weather (leg + last-mile weather minutes),
facility congestion (queue minutes), carrier delay (positive carrier deviation + late pickup), route
change (extra planned minutes of the alternate path), delivery exception (failed-attempt minutes) and
missing tracking (overdue with no scan for 48 h). Reasons under 30 min are dropped; if none remain the
delay is `UNATTRIBUTED`. The largest contribution is primary (exactly one per delayed shipment).

## 7. Validation engine

Standalone (`npm run validate`), no Express required. Three passes:

1. **Schema pass** - one aggregation scan per collection computes required-field, enum and ID-format
   violations for every path derived from the Mongoose schema (including nested subdocuments), plus a
   business-ID uniqueness aggregation.
2. **Reference pass** - master data, routes, weather windows and every queue observation.
3. **Per-shipment merge-join** - six cursors sorted by `shipmentId` (shipments, events, legs, ETA
   snapshots, ground truth, delay reasons) are streamed together; children whose shipment does not
   exist are reported as orphans. Memory stays bounded by one shipment's records plus reference data.
   Every ETA snapshot is fully recomputed from the database.

Every failure produces `{ ruleId, severity, entityType, recordId, shipmentId, status, classification,
anomalyId, expected, actual, explanation, recommendedCorrection }`. A failure is `INTENTIONAL_ANOMALY`
only when the shipment carries a labelled anomaly case whose `expectedRuleIds` contains that rule;
everything else is `UNEXPECTED`. The run **PASSES** only if there are zero unexpected ERROR/CRITICAL
failures *and* every labelled anomaly was detected by all of its expected rules.

Rule catalogue: see `src/validators/rules.js` (39 rules) and the README table.

## 8. Anomaly design

Anomalies live in dedicated shipments (`SHP-2026-9xxxxx`, `partition: ANOMALY`). Each starts as a
clean simulated shipment and receives exactly one documented mutation, so baseline records are never
touched. `anomaly_cases` stores the scenario, variant, affected record IDs and expected rule IDs;
`anomaly_manifest.json` exports them together with the catalogue of *valid* edge cases (reroutes,
delayed scans, failed attempts, open exceptions, insufficient data, at-risk, weather delays) that the
validator must not flag.

## 9. Performance notes

* Bulk inserts in bounded batches (`BATCH_SIZE`, default 1000 shipments ≈ 6k events per write group),
  ordered writes, failures surface as `DataWriteError` (never swallowed).
* Indexes are created before loading; queries use projections and indexed sorts; exports and
  validation use cursors (`batchSize` 2000) with stream back-pressure.
* No unbounded `Promise.all` over records; the only parallel calls are fixed small sets.
* Measured at full volume (README section 15): 440 MB data / 95 MB compressed on disk / 63 MB indexes;
  generation 222 s, validation 63 s on a laptop with local MongoDB 8.0. Peak Node memory was not
  instrumented; the design keeps only reference data (routes, queue observations, weather) and one
  batch / one shipment's records in memory. Your hardware will differ.
