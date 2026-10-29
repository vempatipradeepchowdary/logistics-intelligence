-- Relational schema generated from the MongoDB data model (src/scripts/exportSqlJson.js).
-- Portable SQL (tested on SQLite 3.50; types are PostgreSQL-compatible).
-- Many-to-many links embedded as arrays in MongoDB are normalised into bridge tables.
-- Foreign keys are DEFERRABLE INITIALLY DEFERRED: checked when each seed file COMMITs.

CREATE TABLE carriers (
  carrier_id TEXT PRIMARY KEY,
  name TEXT,
  code TEXT,
  mode TEXT,
  transit_time_factor NUMERIC,
  transit_variability NUMERIC,
  scan_compliance_rate NUMERIC,
  edi_batch_share NUMERIC,
  on_time_pickup_rate NUMERIC,
  market_share_weight NUMERIC,
  active BOOLEAN
);

CREATE TABLE service_levels (
  service_level_id TEXT PRIMARY KEY,
  name TEXT,
  transport_mode TEXT,
  transit_days_by_zone_z1 NUMERIC,
  transit_days_by_zone_z2 NUMERIC,
  transit_days_by_zone_z3 NUMERIC,
  transit_days_by_zone_z4 NUMERIC,
  pickup_cutoff_minute_utc NUMERIC,
  deadline_minute_utc NUMERIC,
  handling_factor NUMERIC,
  at_risk_buffer_minutes NUMERIC,
  priority NUMERIC,
  mix_weight NUMERIC
);

CREATE TABLE facilities (
  facility_id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  city TEXT,
  state_code TEXT,
  region TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  timezone TEXT,
  parent_hub_id TEXT,
  capacity_per_hour NUMERIC,
  base_processing_minutes NUMERIC,
  baseline_queue_wait_minutes NUMERIC,
  operating_status TEXT,
  FOREIGN KEY (parent_hub_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE routes (
  route_id TEXT PRIMARY KEY,
  version NUMERIC,
  route_type TEXT,
  primary_route_id TEXT,
  origin_facility_id TEXT,
  destination_facility_id TEXT,
  total_distance_km NUMERIC,
  distance_zone TEXT,
  effective_from TIMESTAMP,
  FOREIGN KEY (primary_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (origin_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (destination_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE weather_events (
  weather_event_id TEXT PRIMARY KEY,
  weather_type TEXT,
  severity NUMERIC,
  advisory_type TEXT,
  center_facility_id TEXT,
  radius_km NUMERIC,
  start_at TIMESTAMP,
  end_at TIMESTAMP,
  issued_at TIMESTAMP,
  ingested_at TIMESTAMP,
  expected_delay_minutes NUMERIC,
  transit_slowdown_pct NUMERIC,
  FOREIGN KEY (center_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE facility_queues (
  queue_observation_id TEXT PRIMARY KEY,
  facility_id TEXT,
  observed_at TIMESTAMP,
  ingested_at TIMESTAMP,
  window_minutes NUMERIC,
  queue_length NUMERIC,
  throughput_per_hour NUMERIC,
  utilization_pct NUMERIC,
  estimated_wait_minutes NUMERIC,
  baseline_wait_minutes NUMERIC,
  congestion_level TEXT,
  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE shipments (
  shipment_id TEXT PRIMARY KEY,
  sequence NUMERIC,
  partition TEXT,
  carrier_id TEXT,
  service_level_id TEXT,
  origin_facility_id TEXT,
  destination_facility_id TEXT,
  planned_route_id TEXT,
  current_route_id TEXT,
  distance_zone TEXT,
  created_at TIMESTAMP,
  planned_pickup_at TIMESTAMP,
  promised_delivery_at TIMESTAMP,
  picked_up_at TIMESTAMP,
  delivered_at TIMESTAMP,
  status TEXT,
  status_updated_at TIMESTAMP,
  weight_kg NUMERIC,
  pieces NUMERIC,
  route_change_occurred_at TIMESTAMP,
  route_change_at_facility_id TEXT,
  route_change_reason TEXT,
  route_change_from_route_id TEXT,
  route_change_to_route_id TEXT,
  route_change_extra_planned_minutes NUMERIC,
  last_mile_arrived_at_station_at TIMESTAMP,
  last_mile_ready_at TIMESTAMP,
  last_mile_planned_dwell_minutes NUMERIC,
  last_mile_queue_minutes NUMERIC,
  last_mile_weather_minutes NUMERIC,
  last_mile_first_out_for_delivery_at TIMESTAMP,
  last_mile_attempt_failed BOOLEAN,
  last_mile_attempt_delay_minutes NUMERIC,
  data_as_of TIMESTAMP,
  FOREIGN KEY (carrier_id) REFERENCES carriers (carrier_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (service_level_id) REFERENCES service_levels (service_level_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (origin_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (destination_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (planned_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (current_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (route_change_at_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (route_change_from_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (route_change_to_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE shipment_legs (
  leg_id TEXT PRIMARY KEY,
  shipment_id TEXT,
  partition TEXT,
  sequence NUMERIC,
  route_id TEXT,
  route_leg_sequence NUMERIC,
  from_facility_id TEXT,
  to_facility_id TEXT,
  transport_mode TEXT,
  status TEXT,
  distance_km NUMERIC,
  planned_dwell_minutes NUMERIC,
  planned_transit_minutes NUMERIC,
  actual_start_at TIMESTAMP,
  actual_departure_at TIMESTAMP,
  actual_arrival_at TIMESTAMP,
  actual_dwell_minutes NUMERIC,
  actual_transit_minutes NUMERIC,
  delay_breakdown_queue_minutes NUMERIC,
  delay_breakdown_weather_minutes NUMERIC,
  delay_breakdown_carrier_minutes NUMERIC,
  cancelled_at TIMESTAMP,
  FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (from_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (to_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE tracking_events (
  event_id TEXT PRIMARY KEY,
  shipment_id TEXT,
  partition TEXT,
  leg_id TEXT,
  sequence NUMERIC,
  event_type TEXT,
  facility_id TEXT,
  occurred_at TIMESTAMP,
  ingested_at TIMESTAMP,
  source TEXT,
  exception_code TEXT,
  route_change_from_route_id TEXT,
  route_change_to_route_id TEXT,
  route_change_reason TEXT,
  FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (leg_id) REFERENCES shipment_legs (leg_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (route_change_from_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (route_change_to_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE eta_estimates (
  eta_id TEXT PRIMARY KEY,
  shipment_id TEXT,
  partition TEXT,
  prediction_at TIMESTAMP,
  estimated_arrival_at TIMESTAMP,
  algorithm_version TEXT,
  config_hash TEXT,
  input_hash TEXT,
  confidence TEXT,
  position_phase TEXT,
  position_route_id TEXT,
  position_stop_index NUMERIC,
  position_facility_id TEXT,
  watermark_events_considered NUMERIC,
  watermark_last_event_id TEXT,
  watermark_last_event_occurred_at TIMESTAMP,
  watermark_max_event_ingested_at TIMESTAMP,
  watermark_max_queue_ingested_at TIMESTAMP,
  watermark_max_weather_ingested_at TIMESTAMP,
  inputs_carrier_known BOOLEAN,
  adjustments_base_remaining_minutes NUMERIC,
  adjustments_queue_minutes NUMERIC,
  adjustments_weather_minutes NUMERIC,
  adjustments_hold_minutes NUMERIC,
  adjustments_interaction_minutes NUMERIC,
  adjustments_total_remaining_minutes NUMERIC,
  evaluation_actual_arrival_at TIMESTAMP,
  evaluation_error_minutes NUMERIC,
  evaluation_abs_error_minutes NUMERIC,
  evaluation_horizon_minutes NUMERIC,
  FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (position_route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (position_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (watermark_last_event_id) REFERENCES tracking_events (event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE delay_reasons (
  delay_id TEXT PRIMARY KEY,
  shipment_id TEXT,
  partition TEXT,
  reason_code TEXT,
  attributed_minutes NUMERIC,
  shipment_delay_minutes NUMERIC,
  is_primary BOOLEAN,
  rule_version TEXT,
  FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE ground_truth (
  ground_truth_id TEXT PRIMARY KEY,
  shipment_id TEXT,
  partition TEXT,
  delivery_outcome TEXT,
  delay_class TEXT,
  actual_delivered_at TIMESTAMP,
  promised_delivery_at TIMESTAMP,
  delay_minutes NUMERIC,
  primary_reason_code TEXT,
  has_open_exception BOOLEAN,
  has_pickup_scan BOOLEAN,
  eta_at_as_of_id TEXT,
  eta_at_as_of TIMESTAMP,
  as_of TIMESTAMP,
  label_rule_version TEXT,
  rationale TEXT,
  FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (eta_at_as_of_id) REFERENCES eta_estimates (eta_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE route_stops (
  route_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  facility_id TEXT NOT NULL,
  PRIMARY KEY (route_id, sequence),
  FOREIGN KEY (route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE route_legs (
  route_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  from_facility_id TEXT NOT NULL,
  to_facility_id TEXT NOT NULL,
  distance_km NUMERIC NOT NULL,
  planned_ground_minutes NUMERIC NOT NULL,
  planned_air_minutes NUMERIC,
  PRIMARY KEY (route_id, sequence),
  FOREIGN KEY (route_id) REFERENCES routes (route_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (from_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (to_facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE carrier_service_levels (
  carrier_id TEXT NOT NULL,
  service_level_id TEXT NOT NULL,
  PRIMARY KEY (carrier_id, service_level_id),
  FOREIGN KEY (carrier_id) REFERENCES carriers (carrier_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (service_level_id) REFERENCES service_levels (service_level_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE weather_event_facilities (
  weather_event_id TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  PRIMARY KEY (weather_event_id, facility_id),
  FOREIGN KEY (weather_event_id) REFERENCES weather_events (weather_event_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE facility_queue_weather_events (
  queue_observation_id TEXT NOT NULL,
  weather_event_id TEXT NOT NULL,
  PRIMARY KEY (queue_observation_id, weather_event_id),
  FOREIGN KEY (queue_observation_id) REFERENCES facility_queues (queue_observation_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (weather_event_id) REFERENCES weather_events (weather_event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE shipment_last_mile_weather_events (
  shipment_id TEXT NOT NULL,
  weather_event_id TEXT NOT NULL,
  PRIMARY KEY (shipment_id, weather_event_id),
  FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (weather_event_id) REFERENCES weather_events (weather_event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE shipment_leg_weather_events (
  leg_id TEXT NOT NULL,
  weather_event_id TEXT NOT NULL,
  PRIMARY KEY (leg_id, weather_event_id),
  FOREIGN KEY (leg_id) REFERENCES shipment_legs (leg_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (weather_event_id) REFERENCES weather_events (weather_event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE eta_input_events (
  eta_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (eta_id, position),
  FOREIGN KEY (eta_id) REFERENCES eta_estimates (eta_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (event_id) REFERENCES tracking_events (event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE eta_ignored_events (
  eta_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (eta_id, event_id),
  FOREIGN KEY (eta_id) REFERENCES eta_estimates (eta_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (event_id) REFERENCES tracking_events (event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE eta_queue_observations (
  eta_id TEXT NOT NULL,
  queue_observation_id TEXT NOT NULL,
  PRIMARY KEY (eta_id, queue_observation_id),
  FOREIGN KEY (eta_id) REFERENCES eta_estimates (eta_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (queue_observation_id) REFERENCES facility_queues (queue_observation_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE eta_weather_events (
  eta_id TEXT NOT NULL,
  weather_event_id TEXT NOT NULL,
  PRIMARY KEY (eta_id, weather_event_id),
  FOREIGN KEY (eta_id) REFERENCES eta_estimates (eta_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (weather_event_id) REFERENCES weather_events (weather_event_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE eta_remaining_facilities (
  eta_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  facility_id TEXT NOT NULL,
  PRIMARY KEY (eta_id, position),
  FOREIGN KEY (eta_id) REFERENCES eta_estimates (eta_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE delay_evidence_legs (
  delay_id TEXT NOT NULL,
  leg_id TEXT NOT NULL,
  PRIMARY KEY (delay_id, leg_id),
  FOREIGN KEY (delay_id) REFERENCES delay_reasons (delay_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (leg_id) REFERENCES shipment_legs (leg_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE delay_evidence_facilities (
  delay_id TEXT NOT NULL,
  facility_id TEXT NOT NULL,
  PRIMARY KEY (delay_id, facility_id),
  FOREIGN KEY (delay_id) REFERENCES delay_reasons (delay_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (facility_id) REFERENCES facilities (facility_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE delay_evidence_weather_events (
  delay_id TEXT NOT NULL,
  weather_event_id TEXT NOT NULL,
  PRIMARY KEY (delay_id, weather_event_id),
  FOREIGN KEY (delay_id) REFERENCES delay_reasons (delay_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (weather_event_id) REFERENCES weather_events (weather_event_id) DEFERRABLE INITIALLY DEFERRED
);

