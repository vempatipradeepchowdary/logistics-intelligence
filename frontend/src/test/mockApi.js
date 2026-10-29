import { vi } from 'vitest';
import { ApiError } from '../api/apiClient.js';

// Mocked API module for isolated component tests. Fixtures follow the real backend response
// shapes ({ data, meta }); end-to-end tests run against the real backend instead.

export const ok = (data, meta = {}) => Promise.resolve({ data, meta });

export const fixtures = {
  health: { status: 'ok', version: '1.0.0', uptimeSeconds: 120, database: { state: 'connected', pingMs: 2 } },
  config: {
    version: '1.0.0',
    environment: 'test',
    generator: { defaultSeed: 20261022, defaultBatchSize: 1000, defaultProfile: 'small', profiles: {}, behaviour: 'replaces' },
    validation: { rules: 39, lateIngestionThresholdMinutes: 360 },
    api: { maxPageSize: 200, defaultPageSize: 25, rateLimitPerMinute: 300, adminRateLimitPerMinute: 20 },
    latestManifest: null,
  },
  summary: {
    partition: 'BASELINE',
    collections: { shipments: 50000, tracking_events: 300000 },
    shipmentStatus: { DELIVERED: 48613, IN_TRANSIT: 813 },
    serviceLevelMix: { 'SL-EXPRESS': 7000, 'SL-STANDARD': 23000 },
    carrierMix: { 'CAR-001': 8000, 'CAR-002': 12000 },
    delayClasses: { ON_TIME: 46619, DELAYED: 2008, AT_RISK: 4 },
    dataset: {
      manifestId: 'MAN-test',
      seed: 20261022,
      profile: 'full',
      simulationWindow: { asOf: '2026-05-01T00:00:00.000Z' },
      datasetChecksum: 'e8a4ec8640c1b999e20a41950e2aceedbfb2e276f5066122887ba7742ae834ac',
      targetCounts: { shipments: { target: 50000, actual: 50000, ok: true } },
    },
  },
  delays: {
    deliveredShipments: 48613,
    onTimeRate: 0.959,
    avgLatenessMinutesOfLateDeliveries: 871,
    delayClasses: { DELAYED: 2008, AT_RISK: 4 },
    reasons: [{ reasonCode: 'WEATHER_DISRUPTION', primaryCount: 1281, avgAttributedMinutes: 900 }],
    onTimeByServiceLevel: [{ serviceLevelId: 'SL-EXPRESS', delivered: 6847, onTimeRate: 0.9089 }],
  },
  etaAccuracy: { overall: { snapshots: 132354, maeMinutes: 395, p50AbsErrorMinutes: 151 }, byHorizon: [] },
  shipment: (id = 'SHP-2026-000001') => ({
    shipmentId: id,
    partition: 'BASELINE',
    carrierId: 'CAR-001',
    serviceLevelId: 'SL-STANDARD',
    originFacilityId: 'FAC-031',
    destinationFacilityId: 'FAC-050',
    status: 'DELIVERED',
    promisedDeliveryAt: '2026-01-04T23:59:00.000Z',
    latestEta: { etaId: `ETA-${id}-20260102T0000Z`, predictionAt: '2026-01-02T00:00:00.000Z', estimatedArrivalAt: '2026-01-04T12:00:00.000Z', confidence: 'HIGH' },
    lastEvent: { eventId: `EVT-${id}-000006`, eventType: 'DELIVERED', facilityId: 'FAC-050', occurredAt: '2026-01-04T13:00:00.000Z' },
    evaluation: { delayClass: 'ON_TIME', delayMinutes: 0 },
  }),
};

/** Replace every mock function on the (mocked) module with fresh defaults. */
export function resetApiMock(api) {
  const fresh = createApiMock();
  for (const [group, fns] of Object.entries(fresh)) Object.assign(api[group], fns);
}

export function createApiMock() {
  return {
    healthApi: { get: vi.fn(() => ok(fixtures.health)), systemConfig: vi.fn(() => ok(fixtures.config)) },
    shipmentApi: {
      list: vi.fn(() => ok([fixtures.shipment()], { page: 1, limit: 25, total: 1, totalPages: 1 })),
      get: vi.fn(),
      events: vi.fn(),
      etas: vi.fn(() => ok([])),
      timeline: vi.fn(() => ok({ entries: [] })),
    },
    trackingApi: { list: vi.fn(() => ok([], { total: 0, totalPages: 0, lateThresholdMinutes: 360 })) },
    etaApi: {
      list: vi.fn(() => ok([], { total: 0, totalPages: 0 })),
      get: vi.fn(),
      accuracy: vi.fn(() => ok(fixtures.etaAccuracy)),
      breakdowns: vi.fn(() => ok({ overall: null, errorHistogram: [] })),
    },
    analyticsApi: {
      summary: vi.fn(() => ok(fixtures.summary)),
      delays: vi.fn(() => ok(fixtures.delays)),
      delayBreakdowns: vi.fn(() => ok({ byCarrier: [], overTime: [], byFacility: [] })),
      classifiedShipments: vi.fn(() => ok([], { total: 0, totalPages: 0 })),
      eventVolume: vi.fn(() => ok({ daily: [], byType: [], bySource: [] })),
    },
    facilityApi: { list: vi.fn(() => ok([], { total: 0 })), get: vi.fn() },
    disruptionApi: { list: vi.fn(() => ok([], { total: 0 })), timeline: vi.fn(() => ok([])), get: vi.fn() },
    qualityApi: {
      latest: vi.fn(() => Promise.reject(new ApiError({ message: 'No validation run yet', status: 404, code: 'NOT_FOUND' }))), violations: vi.fn(() => ok([], { total: 0, totalPages: 0, facets: {} })), runValidation: vi.fn() },
    jobApi: { list: vi.fn(() => ok([], { active: null })), get: vi.fn() },
    generatorApi: { start: vi.fn() },
    exportApi: {
      list: vi.fn(() => ok([])),
      start: vi.fn(),
      fileUrl: (label, file) => `/api/exports/${label}/files/${file}`,
    },
  };
}
