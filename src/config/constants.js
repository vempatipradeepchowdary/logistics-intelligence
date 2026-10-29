// Central enumerations shared by schemas, generators, validators and the API.

export const PARTITIONS = Object.freeze(['BASELINE', 'ANOMALY']);
export const FACILITY_TYPES = Object.freeze(['HUB', 'SORT_CENTER', 'DELIVERY_STATION']);
export const CARRIER_MODES = Object.freeze(['GROUND', 'AIR', 'MULTIMODAL']);
export const TRANSPORT_MODES = Object.freeze(['GROUND', 'AIR']);
export const ROUTE_TYPES = Object.freeze(['PRIMARY', 'ALTERNATE']);
export const DISTANCE_ZONES = Object.freeze(['Z1', 'Z2', 'Z3', 'Z4']);

export const SHIPMENT_STATUSES = Object.freeze([
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
]);

export const EVENT_TYPES = Object.freeze([
  'PICKED_UP',
  'ARRIVED_AT_FACILITY',
  'DEPARTED_FACILITY',
  'ROUTE_CHANGED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'EXCEPTION',
  'DELIVERED',
]);

export const EVENT_SOURCES = Object.freeze([
  'DRIVER_APP',
  'FACILITY_SCANNER',
  'EDI_BATCH',
  'SYSTEM',
]);

export const EXCEPTION_CODES = Object.freeze(['DAMAGED', 'DELIVERY_ATTEMPT_FAILED']);
export const ROUTE_CHANGE_REASONS = Object.freeze(['WEATHER_AVOIDANCE', 'LINEHAUL_CAPACITY']);

export const LEG_STATUSES = Object.freeze(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

export const WEATHER_TYPES = Object.freeze([
  'SNOW',
  'ICE',
  'THUNDERSTORM',
  'HURRICANE',
  'FLOOD',
  'FOG',
  'HIGH_WIND',
  'EXTREME_HEAT',
]);
export const WEATHER_ADVISORY_TYPES = Object.freeze(['FORECAST', 'NOWCAST']);
export const CONGESTION_LEVELS = Object.freeze(['LOW', 'MODERATE', 'HIGH', 'SEVERE']);

export const DELAY_REASON_CODES = Object.freeze([
  'WEATHER_DISRUPTION',
  'FACILITY_CONGESTION',
  'CARRIER_DELAY',
  'ROUTE_CHANGE',
  'DELIVERY_EXCEPTION',
  'MISSING_TRACKING_INFO',
  'UNATTRIBUTED',
]);

export const DELAY_CLASSES = Object.freeze([
  'ON_TIME',
  'DELAYED',
  'AT_RISK',
  'ON_TRACK',
  'OPERATIONAL_EXCEPTION',
  'INSUFFICIENT_DATA',
]);
export const DELIVERY_OUTCOMES = Object.freeze(['DELIVERED', 'NOT_DELIVERED']);

export const ETA_CONFIDENCE = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
export const ETA_POSITION_PHASES = Object.freeze([
  'PRE_PICKUP',
  'AT_FACILITY',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'ATTEMPT_FAILED',
  'HOLD',
  'DELIVERED',
]);

export const JOB_TYPES = Object.freeze(['GENERATE', 'VALIDATE', 'EXPORT']);
export const JOB_STATUSES = Object.freeze(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']);

export const VALIDATION_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);

export const ANOMALY_SCENARIOS = Object.freeze([
  'A_INGESTION_TIME_CONFUSION',
  'B_IMPOSSIBLE_ROUTE_ORDER',
  'C_FUTURE_DATA_LEAKAGE',
  'D_DELIVERED_STILL_IN_TRANSIT',
  'E_DUPLICATE_EVENT',
  'F_INVALID_REFERENCE',
  'G_INVALID_TIMESTAMP',
  'H_ILLEGAL_LIFECYCLE',
  'I_MISSING_EVENT_GAP',
]);

/** Business-ID formats. Anomaly shipments use the reserved 9xxxxx sequence range. */
export const ID_PATTERNS = Object.freeze({
  shipmentId: /^SHP-\d{4}-\d{6}$/,
  legId: /^LEG-SHP-\d{4}-\d{6}-\d{2}$/,
  eventId: /^EVT-SHP-\d{4}-\d{6}-\d{6}$/,
  etaId: /^ETA-SHP-\d{4}-\d{6}-\d{8}T\d{4}Z$/,
  delayId: /^DLY-\d{4}-\d{6}$/,
  facilityId: /^FAC-\d{3}$/,
  carrierId: /^CAR-\d{3}$/,
  routeId: /^RTE-\d{5}$/,
  serviceLevelId: /^SL-[A-Z]+$/,
  weatherEventId: /^WX-\d{4}-\d{5}$/,
  queueObservationId: /^FQ-FAC-\d{3}-\d{8}T\d{4}Z$/,
  groundTruthId: /^GT-SHP-\d{4}-\d{6}$/,
  anomalyId: /^ANM-\d{4}-\d{4}$/,
});

export const ANOMALY_SEQUENCE_START = 900001;
