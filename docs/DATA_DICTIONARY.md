# Data Dictionary

> Generated from the Mongoose schemas by `npm run docs:dictionary`. Do not edit by hand.

All timestamps are stored as BSON dates in UTC and exported as ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).
Duration fields are integer minutes. `partition` separates clean BASELINE data from labelled ANOMALY cases.

## Carrier (`carriers`)

Business key: `carrierId` - export: `exports/<label>/carriers.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `carrierId` | String | yes | format: `^CAR-\d{3}$`; immutable | Carrier business ID (CAR-001) |
| `name` | String | yes |  |  |
| `code` | String | yes | format: `^[A-Z]{4}$` | Four-letter synthetic carrier code |
| `mode` | String | yes | enum: GROUND, AIR, MULTIMODAL |  |
| `supportedServiceLevelIds` | Array<String> | no |  | Service levels the carrier is contracted for (refs ServiceLevel) |
| `transitTimeFactor` | Number | yes | min 0.8; max 1.5 | Configured historical multiplier on planned transit time; used by the ETA engine |
| `transitVariability` | Number | yes | min 0; max 1 | Lognormal sigma of actual transit noise (simulation only, not used for ETA) |
| `scanComplianceRate` | Number | yes | min 0.5; max 1 |  |
| `ediBatchShare` | Number | yes | min 0; max 1 |  |
| `onTimePickupRate` | Number | yes | min 0; max 1 |  |
| `marketShareWeight` | Number | yes | min 0 |  |
| `active` | Boolean | yes |  |  |

**Indexes**

- `{"carrierId":1}` (unique)
- `{"code":1}` (unique)

## ServiceLevel (`service_levels`)

Business key: `serviceLevelId` - export: `exports/<label>/service_levels.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `serviceLevelId` | String | yes | format: `^SL-[A-Z]+$`; immutable | Service level ID (SL-EXPRESS) |
| `name` | String | yes |  |  |
| `transportMode` | String | yes | enum: GROUND, AIR | Linehaul mode for long hub-to-hub legs |
| `transitDaysByZone` | Object | yes |  | Committed calendar transit days per distance zone |
| `transitDaysByZone.Z1` | Number | yes | min 1; max 14 |  |
| `transitDaysByZone.Z2` | Number | yes | min 1; max 14 |  |
| `transitDaysByZone.Z3` | Number | yes | min 1; max 14 |  |
| `transitDaysByZone.Z4` | Number | yes | min 1; max 14 |  |
| `pickupCutoffMinuteUtc` | Number | yes | min 0 | Tender cutoff (minute of UTC day); later tenders start next day |
| `deadlineMinuteUtc` | Number | yes | min 0 | Minute of UTC day by which delivery is promised on the due day |
| `handlingFactor` | Number | yes | min 0.1; max 3 |  |
| `atRiskBufferMinutes` | Number | yes | min 0 | ETA within this buffer of the deadline counts as at-risk |
| `priority` | Number | yes | min 1; max 10 |  |
| `mixWeight` | Number | yes | min 0 |  |

**Indexes**

- `{"serviceLevelId":1}` (unique)

## Facility (`facilities`)

Business key: `facilityId` - export: `exports/<label>/facilities.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `facilityId` | String | yes | format: `^FAC-\d{3}$`; immutable | Facility business ID (FAC-001) |
| `name` | String | yes |  |  |
| `type` | String | yes | enum: HUB, SORT_CENTER, DELIVERY_STATION |  |
| `city` | String | yes |  |  |
| `stateCode` | String | yes | format: `^[A-Z]{2}$` |  |
| `region` | String | yes |  |  |
| `latitude` | Number | yes | min -90; max 90 |  |
| `longitude` | Number | yes | min -180; max 180 |  |
| `timezone` | String | yes |  | IANA zone (informational; all times stored UTC) |
| `parentHubId` | String | no | format: `^FAC-\d{3}$`; nullable | Hub this facility feeds (null for hubs) |
| `capacityPerHour` | Number | yes | min 1 |  |
| `baseProcessingMinutes` | Number | yes | min 1 | Planned processing dwell before service-level handling factor |
| `baselineQueueWaitMinutes` | Number | yes | min 0 | Normal queue wait; observations above it count as congestion |
| `operatingStatus` | String | yes | enum: ACTIVE |  |

**Indexes**

- `{"facilityId":1}` (unique)
- `{"type":1,"region":1}`

## Route (`routes`)

Business key: `routeId` - export: `exports/<label>/routes.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `routeId` | String | yes | format: `^RTE-\d{5}$`; immutable | Route business ID (RTE-00001) |
| `version` | Number | yes | min 1; immutable |  |
| `routeType` | String | yes | enum: PRIMARY, ALTERNATE |  |
| `primaryRouteId` | String | no | format: `^RTE-\d{5}$`; nullable | For ALTERNATE routes, the primary route replaced |
| `originFacilityId` | String | yes | format: `^FAC-\d{3}$` | Origin delivery station |
| `destinationFacilityId` | String | yes | format: `^FAC-\d{3}$` | Destination delivery station |
| `stops` | Array<Object> | no |  |  |
| `stops[].sequence` | Number | yes | min 0 |  |
| `stops[].facilityId` | String | yes | format: `^FAC-\d{3}$` | Stop facility |
| `legs` | Array<Object> | no |  |  |
| `legs[].sequence` | Number | yes | min 1 |  |
| `legs[].fromFacilityId` | String | yes | format: `^FAC-\d{3}$` | Leg origin facility |
| `legs[].toFacilityId` | String | yes | format: `^FAC-\d{3}$` | Leg destination facility |
| `legs[].distanceKm` | Number | yes | min 1 |  |
| `legs[].plannedGroundMinutes` | Number | yes | min 1 | Planned ground transit minutes |
| `legs[].plannedAirMinutes` | Number | no | min 1; nullable | Planned air transit minutes (null when the lane is not air-eligible) |
| `totalDistanceKm` | Number | yes | min 1 |  |
| `distanceZone` | String | yes | enum: Z1, Z2, Z3, Z4 |  |
| `effectiveFrom` | Date | yes |  | Version effective-from time |

**Indexes**

- `{"routeId":1}` (unique)
- `{"routeId":1,"version":1}` (unique)
- `{"originFacilityId":1,"destinationFacilityId":1,"routeType":1}` (unique)

## WeatherEvent (`weather_events`)

Business key: `weatherEventId` - export: `exports/<label>/weather_events.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `weatherEventId` | String | yes | format: `^WX-\d{4}-\d{5}$`; immutable | Disruption window ID (WX-2026-00001) |
| `weatherType` | String | yes | enum: SNOW, ICE, THUNDERSTORM, HURRICANE, FLOOD, FOG, HIGH_WIND, EXTREME_HEAT |  |
| `severity` | Number | yes | min 1; max 5 |  |
| `advisoryType` | String | yes | enum: FORECAST, NOWCAST | FORECAST = issued before start; NOWCAST = issued after it began |
| `centerFacilityId` | String | yes | format: `^FAC-\d{3}$` | Facility nearest the disruption center |
| `affectedFacilityIds` | Array<String> | no |  |  |
| `radiusKm` | Number | yes | min 1 |  |
| `startAt` | Date | yes |  | Disruption window start |
| `endAt` | Date | yes |  | Disruption window end (exclusive) |
| `issuedAt` | Date | yes |  | Advisory issue time |
| `ingestedAt` | Date | yes |  | When the advisory became available to the platform |
| `expectedDelayMinutes` | Number | yes | min 0 | Advisory processing delay per affected facility |
| `transitSlowdownPct` | Number | yes | min 0; max 100 |  |

**Indexes**

- `{"weatherEventId":1}` (unique)
- `{"affectedFacilityIds":1,"startAt":1}`
- `{"ingestedAt":1}`

## FacilityQueue (`facility_queues`)

Business key: `queueObservationId` - export: `exports/<label>/facility_queues.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `queueObservationId` | String | yes | format: `^FQ-FAC-\d{3}-\d{8}T\d{4}Z$`; immutable | Observation ID (FQ-<facility>-<ts>) |
| `facilityId` | String | yes | format: `^FAC-\d{3}$` | Observed facility |
| `observedAt` | Date | yes |  | Start of the observed 4-hour window |
| `ingestedAt` | Date | yes |  | When the observation became available to the platform |
| `windowMinutes` | Number | yes | min 1 | Observation window length |
| `queueLength` | Number | yes | min 0 |  |
| `throughputPerHour` | Number | yes | min 0 |  |
| `utilizationPct` | Number | yes | min 0; max 200 |  |
| `estimatedWaitMinutes` | Number | yes | min 0 | Observed total wait (queue + weather surge) |
| `baselineWaitMinutes` | Number | yes | min 0 | Facility normal wait |
| `congestionLevel` | String | yes | enum: LOW, MODERATE, HIGH, SEVERE |  |
| `activeWeatherEventIds` | Array<String> | no |  |  |

**Indexes**

- `{"queueObservationId":1}` (unique)
- `{"facilityId":1,"observedAt":1}` (unique)
- `{"ingestedAt":1}`

## Shipment (`shipments`)

Business key: `shipmentId` - export: `exports/<label>/shipments.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$`; immutable | Shipment business ID (SHP-2026-000001) |
| `sequence` | Number | yes | min 1; immutable |  |
| `partition` | String | yes | enum: BASELINE, ANOMALY | BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases |
| `carrierId` | String | yes | format: `^CAR-\d{3}$` | Assigned carrier |
| `serviceLevelId` | String | yes | format: `^SL-[A-Z]+$` | Contracted service level |
| `originFacilityId` | String | yes | format: `^FAC-\d{3}$` | Origin delivery station |
| `destinationFacilityId` | String | yes | format: `^FAC-\d{3}$` | Destination delivery station |
| `plannedRouteId` | String | yes | format: `^RTE-\d{5}$` | Route planned at creation |
| `currentRouteId` | String | yes | format: `^RTE-\d{5}$` | Route currently in force (differs after a reroute) |
| `distanceZone` | String | yes | enum: Z1, Z2, Z3, Z4 |  |
| `createdAt` | Date | yes |  | Business creation (label/tender) time - not a record timestamp |
| `plannedPickupAt` | Date | yes |  | Planned pickup time from the service-level cutoff rule |
| `promisedDeliveryAt` | Date | yes |  | SLA delivery deadline |
| `pickedUpAt` | Date | no | nullable | Observed pickup (PICKED_UP event occurrence) |
| `deliveredAt` | Date | no | nullable | Observed delivery (DELIVERED event occurrence) |
| `status` | String | yes | enum: CREATED, PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION | Operational status as recorded by the system at dataAsOf |
| `statusUpdatedAt` | Date | no | nullable | Occurrence time of the event that set the status |
| `weightKg` | Number | yes | min 0.1; max 1000 |  |
| `pieces` | Number | yes | min 1; max 50 |  |
| `routeChange` | Object | no | nullable |  |
| `routeChange.occurredAt` | Date | yes |  | When the reroute decision was made |
| `routeChange.atFacilityId` | String | yes | format: `^FAC-\d{3}$` | Facility where the reroute happened |
| `routeChange.reason` | String | yes | enum: WEATHER_AVOIDANCE, LINEHAUL_CAPACITY |  |
| `routeChange.fromRouteId` | String | yes | format: `^RTE-\d{5}$` | Superseded route |
| `routeChange.toRouteId` | String | yes | format: `^RTE-\d{5}$` | Replacement route |
| `routeChange.extraPlannedMinutes` | Number | yes |  | Planned-time difference new vs old remaining path |
| `lastMile` | Object | no | nullable |  |
| `lastMile.arrivedAtStationAt` | Date | no | nullable | Arrival at destination delivery station |
| `lastMile.readyAt` | Date | no | nullable | Station processing complete |
| `lastMile.plannedDwellMinutes` | Number | yes | min 0 | Planned station processing |
| `lastMile.queueMinutes` | Number | yes | min 0 | Queue delay at destination station |
| `lastMile.weatherMinutes` | Number | yes | min 0 | Weather delay at destination station |
| `lastMile.weatherEventIds` | Array<String> | no |  |  |
| `lastMile.firstOutForDeliveryAt` | Date | no | nullable | First out-for-delivery time |
| `lastMile.attemptFailed` | Boolean | yes |  |  |
| `lastMile.attemptDelayMinutes` | Number | yes | min 0 | Extra minutes caused by a failed delivery attempt |
| `dataAsOf` | Date | yes |  | Snapshot time of the dataset |

**Indexes**

- `{"shipmentId":1}` (unique)
- `{"partition":1,"shipmentId":1}`
- `{"status":1,"shipmentId":1}`
- `{"carrierId":1,"createdAt":1}`
- `{"serviceLevelId":1,"createdAt":1}`
- `{"originFacilityId":1}`
- `{"destinationFacilityId":1}`
- `{"createdAt":1}`

## ShipmentLeg (`shipment_legs`)

Business key: `legId` - export: `exports/<label>/shipment_legs.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `legId` | String | yes | format: `^LEG-SHP-\d{4}-\d{6}-\d{2}$`; immutable | Leg business ID (LEG-<shipmentId>-01) |
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$` | Owning shipment |
| `partition` | String | yes | enum: BASELINE, ANOMALY | BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases |
| `sequence` | Number | yes | min 1; max 99 |  |
| `routeId` | String | yes | format: `^RTE-\d{5}$` | Route this leg belongs to |
| `routeLegSequence` | Number | yes | min 1 |  |
| `fromFacilityId` | String | yes | format: `^FAC-\d{3}$` | Leg origin |
| `toFacilityId` | String | yes | format: `^FAC-\d{3}$` | Leg destination |
| `transportMode` | String | yes | enum: GROUND, AIR |  |
| `status` | String | yes | enum: PLANNED, IN_PROGRESS, COMPLETED, CANCELLED |  |
| `distanceKm` | Number | yes | min 1 |  |
| `plannedDwellMinutes` | Number | yes | min 0 | Planned processing at leg origin |
| `plannedTransitMinutes` | Number | yes | min 1 | Planned linehaul minutes |
| `actualStartAt` | Date | no | nullable | Arrival at the leg origin (pickup for leg 1) |
| `actualDepartureAt` | Date | no | nullable | Departure from leg origin |
| `actualArrivalAt` | Date | no | nullable | Arrival at leg destination |
| `actualDwellMinutes` | Number | no | nullable |  |
| `actualTransitMinutes` | Number | no | nullable |  |
| `delayBreakdown` | Object | no | nullable |  |
| `delayBreakdown.queueMinutes` | Number | yes | min 0 | Facility queue delay at leg origin |
| `delayBreakdown.weatherMinutes` | Number | yes | min 0 | Weather delay (dwell + transit) |
| `delayBreakdown.carrierMinutes` | Number | yes |  | Carrier performance deviation (can be negative) |
| `weatherEventIds` | Array<String> | no |  |  |
| `cancelledAt` | Date | no | nullable | Set when a reroute cancels this planned leg |

**Indexes**

- `{"legId":1}` (unique)
- `{"shipmentId":1,"sequence":1}` (unique)
- `{"fromFacilityId":1,"actualDepartureAt":1}`

## TrackingEvent (`tracking_events`)

Business key: `eventId` - export: `exports/<label>/tracking_events.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `eventId` | String | yes | format: `^EVT-SHP-\d{4}-\d{6}-\d{6}$`; immutable | Event business ID (EVT-<shipmentId>-000001) |
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$` | Owning shipment |
| `partition` | String | yes | enum: BASELINE, ANOMALY | BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases |
| `legId` | String | yes | format: `^LEG-SHP-\d{4}-\d{6}-\d{2}$` | Shipment leg the event belongs to |
| `sequence` | Number | yes | min 1 | Per-shipment order of occurrence |
| `eventType` | String | yes | enum: PICKED_UP, ARRIVED_AT_FACILITY, DEPARTED_FACILITY, ROUTE_CHANGED, OUT_FOR_DELIVERY, DELIVERY_ATTEMPTED, EXCEPTION, DELIVERED |  |
| `facilityId` | String | yes | format: `^FAC-\d{3}$` | Facility where the event happened |
| `occurredAt` | Date | yes |  | Event time: when it physically happened |
| `ingestedAt` | Date | yes |  | Ingestion time: when the platform received it |
| `source` | String | yes | enum: DRIVER_APP, FACILITY_SCANNER, EDI_BATCH, SYSTEM |  |
| `exceptionCode` | String | no | enum: DAMAGED, DELIVERY_ATTEMPT_FAILED; nullable |  |
| `routeChange` | Object | no | nullable |  |
| `routeChange.fromRouteId` | String | yes | format: `^RTE-\d{5}$` | Previous route |
| `routeChange.toRouteId` | String | yes | format: `^RTE-\d{5}$` | New route |
| `routeChange.reason` | String | yes | enum: WEATHER_AVOIDANCE, LINEHAUL_CAPACITY |  |

**Indexes**

- `{"eventId":1}` (unique)
- `{"shipmentId":1,"sequence":1}` (unique)
- `{"shipmentId":1,"occurredAt":1}`
- `{"facilityId":1,"occurredAt":1}`
- `{"eventType":1}`
- `{"ingestedAt":1}`

## ETAEstimate (`eta_estimates`)

Business key: `etaId` - export: `exports/<label>/eta_estimates.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `etaId` | String | yes | format: `^ETA-SHP-\d{4}-\d{6}-\d{8}T\d{4}Z$`; immutable | Snapshot ID (ETA-<shipmentId>-<timestamp>) |
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$` | Shipment predicted |
| `partition` | String | yes | enum: BASELINE, ANOMALY | BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases |
| `predictionAt` | Date | yes |  | Prediction time: information cutoff for this snapshot |
| `estimatedArrivalAt` | Date | yes |  | Estimated delivery time |
| `algorithmVersion` | String | yes |  |  |
| `configHash` | String | yes | format: `^[0-9a-f]{64}$` |  |
| `inputHash` | String | yes | format: `^[0-9a-f]{64}$` |  |
| `confidence` | String | yes | enum: HIGH, MEDIUM, LOW |  |
| `position` | Object | yes |  |  |
| `position.phase` | String | yes | enum: PRE_PICKUP, AT_FACILITY, IN_TRANSIT, OUT_FOR_DELIVERY, ATTEMPT_FAILED, HOLD, DELIVERED |  |
| `position.routeId` | String | yes | format: `^RTE-\d{5}$` | Route in force at prediction time |
| `position.stopIndex` | Number | no | nullable |  |
| `position.facilityId` | String | no | format: `^FAC-\d{3}$`; nullable |  |
| `watermark` | Object | yes |  |  |
| `watermark.eventsConsidered` | Number | yes | min 0 |  |
| `watermark.lastEventId` | String | no | format: `^EVT-SHP-\d{4}-\d{6}-\d{6}$`; nullable |  |
| `watermark.lastEventOccurredAt` | Date | no | nullable | Occurrence time of the latest eligible event |
| `watermark.maxEventIngestedAt` | Date | no | nullable | Latest ingestion time among eligible events (must be <= predictionAt) |
| `watermark.maxQueueIngestedAt` | Date | no | nullable | Latest ingestion time among queue observations used |
| `watermark.maxWeatherIngestedAt` | Date | no | nullable | Latest ingestion time among weather advisories used |
| `inputs` | Object | yes |  |  |
| `inputs.eventIds` | Array<String> | no |  |  |
| `inputs.ignoredEventIds` | Array<String> | no |  |  |
| `inputs.queueObservationIds` | Array<String> | no |  |  |
| `inputs.weatherEventIds` | Array<String> | no |  |  |
| `inputs.remainingFacilityIds` | Array<String> | no |  |  |
| `inputs.carrierKnown` | Boolean | yes |  |  |
| `adjustments` | Object | yes |  |  |
| `adjustments.baseRemainingMinutes` | Number | yes |  |  |
| `adjustments.queueMinutes` | Number | yes | min 0 |  |
| `adjustments.weatherMinutes` | Number | yes | min 0 |  |
| `adjustments.holdMinutes` | Number | yes | min 0 |  |
| `adjustments.interactionMinutes` | Number | yes |  | Delivery-wave rounding effect |
| `adjustments.totalRemainingMinutes` | Number | yes | min 0 |  |
| `evaluation` | Object | no | nullable |  |
| `evaluation.actualArrivalAt` | Date | yes |  | Ground-truth delivery time |
| `evaluation.errorMinutes` | Number | yes |  | estimated - actual (positive = late estimate) |
| `evaluation.absErrorMinutes` | Number | yes | min 0 |  |
| `evaluation.horizonMinutes` | Number | yes |  | actual - predictionAt |

**Indexes**

- `{"etaId":1}` (unique)
- `{"shipmentId":1,"predictionAt":1}` (unique)
- `{"partition":1,"evaluation.absErrorMinutes":1}`

## DelayReason (`delay_reasons`)

Business key: `delayId` - export: `exports/<label>/delay_reasons.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `delayId` | String | yes | format: `^DLY-\d{4}-\d{6}$`; immutable | Delay attribution ID (DLY-2026-000001) |
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$` | Delayed shipment |
| `partition` | String | yes | enum: BASELINE, ANOMALY | BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases |
| `reasonCode` | String | yes | enum: WEATHER_DISRUPTION, FACILITY_CONGESTION, CARRIER_DELAY, ROUTE_CHANGE, DELIVERY_EXCEPTION, MISSING_TRACKING_INFO, UNATTRIBUTED |  |
| `attributedMinutes` | Number | yes | min 0 | Minutes of delay attributed to this reason |
| `shipmentDelayMinutes` | Number | yes | min 1 | Total lateness versus the SLA deadline |
| `isPrimary` | Boolean | yes |  |  |
| `evidence` | Object | yes |  |  |
| `evidence.legIds` | Array<String> | no |  |  |
| `evidence.facilityIds` | Array<String> | no |  |  |
| `evidence.weatherEventIds` | Array<String> | no |  |  |
| `ruleVersion` | String | yes |  |  |

**Indexes**

- `{"delayId":1}` (unique)
- `{"shipmentId":1,"reasonCode":1}` (unique)
- `{"reasonCode":1,"isPrimary":1}`

## GroundTruth (`ground_truth`)

Business key: `groundTruthId` - export: `exports/<label>/ground_truth.csv`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `groundTruthId` | String | yes | format: `^GT-SHP-\d{4}-\d{6}$`; immutable | GT-<shipmentId> |
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$` | Labelled shipment |
| `partition` | String | yes | enum: BASELINE, ANOMALY | BASELINE = clean generated data; ANOMALY = explicitly labelled injected test cases |
| `deliveryOutcome` | String | yes | enum: DELIVERED, NOT_DELIVERED |  |
| `delayClass` | String | yes | enum: ON_TIME, DELAYED, AT_RISK, ON_TRACK, OPERATIONAL_EXCEPTION, INSUFFICIENT_DATA |  |
| `actualDeliveredAt` | Date | no | nullable | Physical delivery time (simulation truth) if <= asOf |
| `promisedDeliveryAt` | Date | yes |  | SLA deadline |
| `delayMinutes` | Number | yes | min 0 |  |
| `primaryReasonCode` | String | no | enum: WEATHER_DISRUPTION, FACILITY_CONGESTION, CARRIER_DELAY, ROUTE_CHANGE, DELIVERY_EXCEPTION, MISSING_TRACKING_INFO, UNATTRIBUTED; nullable |  |
| `hasOpenException` | Boolean | yes |  |  |
| `hasPickupScan` | Boolean | yes |  |  |
| `etaAtAsOfId` | String | no | format: `^ETA-SHP-\d{4}-\d{6}-\d{8}T\d{4}Z$`; nullable |  |
| `etaAtAsOf` | Date | no | nullable | ETA estimate at asOf, used for AT_RISK / ON_TRACK |
| `asOf` | Date | yes |  | Label snapshot time |
| `labelRuleVersion` | String | yes |  |  |
| `rationale` | String | yes |  |  |

**Indexes**

- `{"groundTruthId":1}` (unique)
- `{"shipmentId":1}` (unique)
- `{"partition":1,"delayClass":1}`

## AnomalyCase (`anomaly_cases`)

Business key: `anomalyId` - export: `anomaly_manifest.json`

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `anomalyId` | String | yes | format: `^ANM-\d{4}-\d{4}$`; immutable | ANM-2026-0001 |
| `scenario` | String | yes | enum: A_INGESTION_TIME_CONFUSION, B_IMPOSSIBLE_ROUTE_ORDER, C_FUTURE_DATA_LEAKAGE, D_DELIVERED_STILL_IN_TRANSIT, E_DUPLICATE_EVENT, F_INVALID_REFERENCE, G_INVALID_TIMESTAMP, H_ILLEGAL_LIFECYCLE, I_MISSING_EVENT_GAP |  |
| `variant` | String | yes |  |  |
| `shipmentId` | String | yes | format: `^SHP-\d{4}-\d{6}$` |  |
| `affectedRecords` | Array<Object> | no |  |  |
| `affectedRecords[].entityType` | String | yes |  |  |
| `affectedRecords[].recordId` | String | yes |  |  |
| `affectedRecords[].field` | String | no | nullable |  |
| `description` | String | yes |  |  |
| `expectedRuleIds` | Array<String> | no |  |  |
| `expectedOutcome` | String | yes | enum: DETECTED |  |

**Indexes**

- `{"anomalyId":1}` (unique)
- `{"shipmentId":1}`

