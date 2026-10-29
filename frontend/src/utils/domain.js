// Domain vocabularies mirrored from the backend constants (src/config/constants.js) with
// display labels and semantic tones. Tones: good | warn | crit | info | neutral.

export const SHIPMENT_STATUSES = ['CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'];
export const STATUS_TONE = {
  CREATED: 'neutral',
  PICKED_UP: 'info',
  IN_TRANSIT: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'good',
  EXCEPTION: 'warn',
};

export const DELAY_CLASSES = ['ON_TIME', 'DELAYED', 'AT_RISK', 'ON_TRACK', 'OPERATIONAL_EXCEPTION', 'INSUFFICIENT_DATA'];
export const DELAY_TONE = {
  ON_TIME: 'good',
  ON_TRACK: 'good',
  AT_RISK: 'warn',
  DELAYED: 'crit',
  OPERATIONAL_EXCEPTION: 'warn',
  INSUFFICIENT_DATA: 'neutral',
};
export const DELAY_LABEL = {
  ON_TIME: 'On time',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  DELAYED: 'Delayed',
  OPERATIONAL_EXCEPTION: 'Operational exception',
  INSUFFICIENT_DATA: 'Insufficient data',
};

export const EVENT_TYPES = [
  'PICKED_UP',
  'ARRIVED_AT_FACILITY',
  'DEPARTED_FACILITY',
  'ROUTE_CHANGED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'EXCEPTION',
  'DELIVERED',
];
export const EVENT_SOURCES = ['DRIVER_APP', 'FACILITY_SCANNER', 'EDI_BATCH', 'SYSTEM'];

export const DELAY_REASONS = [
  'WEATHER_DISRUPTION',
  'FACILITY_CONGESTION',
  'CARRIER_DELAY',
  'ROUTE_CHANGE',
  'DELIVERY_EXCEPTION',
  'MISSING_TRACKING_INFO',
  'UNATTRIBUTED',
];

export const SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];
export const SEVERITY_TONE = { INFO: 'neutral', WARNING: 'warn', ERROR: 'crit', CRITICAL: 'crit' };

export const CONGESTION_TONE = { LOW: 'good', MODERATE: 'neutral', HIGH: 'warn', SEVERE: 'crit' };
export const CONFIDENCE_TONE = { HIGH: 'good', MEDIUM: 'neutral', LOW: 'warn' };

export const FACILITY_TYPES = ['HUB', 'SORT_CENTER', 'DELIVERY_STATION'];
export const WEATHER_TYPES = ['SNOW', 'ICE', 'THUNDERSTORM', 'HURRICANE', 'FLOOD', 'FOG', 'HIGH_WIND', 'EXTREME_HEAT'];
export const ETA_PHASES = ['PRE_PICKUP', 'AT_FACILITY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPT_FAILED', 'HOLD', 'DELIVERED'];

export const weatherSeverityTone = (s) => (s >= 4 ? 'crit' : s === 3 ? 'warn' : 'neutral');

/** Rule families shown on the data-quality page (rule-ID prefix groups). */
export const RULE_GROUPS = [
  { key: 'reference', label: 'Referential integrity', match: (r) => r === 'REF_INTEGRITY' || r.startsWith('LEG_CHAIN') },
  { key: 'temporal', label: 'Timestamp violations', match: (r) => r.startsWith('TEMPORAL_') || r === 'TRACKING_STALLED' },
  {
    key: 'lifecycle',
    label: 'Lifecycle & sequence',
    match: (r) => r.startsWith('LIFECYCLE_') || r.startsWith('SHIPMENT_STATUS') || r.startsWith('ROUTE_') || r === 'EVENT_DUPLICATE',
  },
  { key: 'leakage', label: 'ETA leakage', match: (r) => r === 'ETA_FUTURE_DATA_LEAKAGE' },
];
