import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, ensureTinyDataset } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
import { runValidation } from '../../src/services/validation.service.js';
import { runExport } from '../../src/services/export.service.js';
import { ETAEstimate, Job } from '../../src/models/index.js';

const KEY = process.env.ADMIN_API_KEY;
let app;

beforeAll(async () => {
  await connectTestDb();
  await ensureTinyDataset();
  await runValidation();
  await runExport({ label: 'explorer-test' });
  app = createApp();
});
afterAll(async () => {
  await Job.deleteMany({});
  await disconnectTestDb();
});

describe('tracking events explorer', () => {
  it('paginates server-side with lag and validation annotations', async () => {
    const res = await request(app).get('/api/events?limit=10&sort=-occurredAt').expect(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toMatchObject({
      page: 1,
      limit: 10,
      total: 3783,
      lateThresholdMinutes: 360,
    });
    const [a, b] = res.body.data;
    expect(Date.parse(a.occurredAt)).toBeGreaterThanOrEqual(Date.parse(b.occurredAt));
    expect(a).toHaveProperty('lagMinutes');
    expect(Array.isArray(a.validation)).toBe(true);
  });

  it('filters late arrivals and validation-flagged events', async () => {
    const late = await request(app).get('/api/events?late=true').expect(200);
    expect(late.body.meta.total).toBeGreaterThan(0);
    expect(late.body.data.every((e) => e.isLateArrival && e.partition === 'ANOMALY')).toBe(true);
    const flagged = await request(app).get('/api/events?flagged=true&limit=200').expect(200);
    expect(flagged.body.data.every((e) => e.validation.length > 0)).toBe(true);
  });

  it('filters by type, time field and range, and rejects unknown params', async () => {
    const res = await request(app)
      .get(
        '/api/events?eventType=DELIVERED&timeField=ingestedAt&from=2026-01-05T00:00:00Z&to=2026-01-06T00:00:00Z&limit=200',
      )
      .expect(200);
    expect(
      res.body.data.every(
        (e) =>
          e.eventType === 'DELIVERED' &&
          e.ingestedAt >= '2026-01-05' &&
          e.ingestedAt <= '2026-01-06T00:00:00.000Z',
      ),
    ).toBe(true);
    await request(app).get('/api/events?eventType=TELEPORT').expect(400);
    await request(app).get('/api/events?sort=random').expect(400);
  });
});

describe('facilities and disruptions', () => {
  it('lists all 100 facilities with queue and volume statistics', async () => {
    const res = await request(app).get('/api/facilities').expect(200);
    expect(res.body.data).toHaveLength(100);
    const hub = res.body.data.find((f) => f.type === 'HUB');
    expect(hub.queue.avgWaitMinutes).toBeGreaterThan(0);
    expect(hub.latestQueueObservation.facilityId).toBe(hub.facilityId);
    const stations = await request(app).get('/api/facilities?type=DELIVERY_STATION').expect(200);
    expect(stations.body.data).toHaveLength(70);
  });

  it('returns a facility with queue history and 404s unknown ids', async () => {
    const res = await request(app).get('/api/facilities/FAC-001?days=7').expect(200);
    expect(res.body.data.facility.facilityId).toBe('FAC-001');
    expect(res.body.data.queueHistory.length).toBe(42); // 7 days x 6 four-hour buckets
    await request(app).get('/api/facilities/FAC-999').expect(404);
    await request(app).get('/api/facilities/nope').expect(400);
  });

  it('lists disruption windows with recorded impact, filters and detail', async () => {
    const res = await request(app).get('/api/disruptions?severity=5&limit=50').expect(200);
    expect(res.body.data.every((w) => w.severity === 5)).toBe(true);
    expect(res.body.data[0]).toHaveProperty('impact.shipments');
    const timeline = await request(app).get('/api/disruptions/timeline').expect(200);
    expect(timeline.body.data[0]).toHaveProperty('date');
    const id = res.body.data[0]?.weatherEventId ?? 'WX-2026-00001';
    const detail = await request(app).get(`/api/disruptions/${id}`).expect(200);
    expect(detail.body.data.event.weatherEventId).toBe(id);
  });
});

describe('ETA snapshots and analytics breakdowns', () => {
  it('lists snapshots and explains one from its own audit fields', async () => {
    const list = await request(app)
      .get('/api/etas?evaluated=true&limit=5&sort=-absError')
      .expect(200);
    const errors = list.body.data.map((e) => e.evaluation.absErrorMinutes);
    expect(errors).toEqual([...errors].sort((a, b) => b - a));
    const id = list.body.data[0].etaId;
    const detail = await request(app).get(`/api/etas/${id}`).expect(200);
    expect(detail.body.data.explanation.length).toBeGreaterThanOrEqual(5);
    expect(detail.body.data.explanation[0]).toContain('Information cut-off');
  });

  it('computes ETA breakdowns consistent with the stored evaluations', async () => {
    const res = await request(app).get('/api/analytics/eta-accuracy/breakdowns').expect(200);
    const evaluated = await ETAEstimate.countDocuments({
      partition: 'BASELINE',
      evaluation: { $ne: null },
    });
    const o = res.body.data.overall;
    expect(o.snapshots).toBe(evaluated);
    expect(o.rmseMinutes).toBeGreaterThanOrEqual(o.maeMinutes);
    expect(o.slaCallAccuracy).toBeGreaterThan(0);
    expect(res.body.data.byCarrier.reduce((s, c) => s + c.snapshots, 0)).toBe(evaluated);
    expect(res.body.data.errorHistogram.reduce((s, h) => s + h.count, 0)).toBe(evaluated);
    const again = await request(app).get('/api/analytics/eta-accuracy/breakdowns').expect(200);
    expect(again.body.data.predictedVsActualSample).toEqual(res.body.data.predictedVsActualSample);
  });

  it('serves delay breakdowns, event volume and classified shipments', async () => {
    const d = await request(app).get('/api/analytics/delays/breakdowns').expect(200);
    expect(d.body.data.byCarrier.length).toBeGreaterThan(0);
    const v = await request(app).get('/api/analytics/event-volume').expect(200);
    expect(v.body.data.daily.reduce((s, x) => s + x.events, 0)).toBe(3600);
    const c = await request(app)
      .get('/api/analytics/delays/shipments?delayClass=DELAYED&limit=5')
      .expect(200);
    expect(c.body.data.every((g) => g.delayClass === 'DELAYED' && g.shipment.carrierId)).toBe(true);
    await request(app).get('/api/analytics/delays/shipments?delayClass=LATE').expect(400);
  });

  it('enriches shipment rows and filters by delay class', async () => {
    const res = await request(app)
      .get('/api/shipments?delayClass=DELAYED&limit=5&sort=-promisedDeliveryAt')
      .expect(200);
    expect(res.body.data.every((s) => s.evaluation.delayClass === 'DELAYED')).toBe(true);
    expect(res.body.data[0]).toHaveProperty('latestEta.estimatedArrivalAt');
    expect(res.body.data[0]).toHaveProperty('lastEvent.eventType');
  });
});

describe('data quality, exports, jobs and system config', () => {
  it('filters validation violations with facets', async () => {
    const res = await request(app)
      .get('/api/analytics/data-quality/violations?classification=INTENTIONAL_ANOMALY&limit=200')
      .expect(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.data.every((v) => v.classification === 'INTENTIONAL_ANOMALY')).toBe(true);
    expect(res.body.meta.facets.ruleId.length).toBeGreaterThan(0);
    const none = await request(app)
      .get('/api/analytics/data-quality/violations?classification=UNEXPECTED')
      .expect(200);
    expect(none.body.meta.total).toBe(0);
  });

  it('lists completed exports and serves only manifest-listed files', async () => {
    const list = await request(app).get('/api/exports').expect(200);
    const exp = list.body.data.find((e) => e.label === 'explorer-test');
    expect(exp.files.map((f) => f.file)).toContain('tracking_events.csv');
    const file = await request(app)
      .get('/api/exports/explorer-test/files/carriers.csv')
      .expect(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers['content-disposition']).toContain('attachment');
    await request(app).get('/api/exports/explorer-test/files/secrets.csv').expect(404);
    await request(app).get('/api/exports/explorer-test/files/..%2F..%2F.env').expect(400);
    await request(app).get('/api/exports/does-not-exist/files/carriers.csv').expect(404);
  });

  it('lists jobs for admins only', async () => {
    await request(app).get('/api/admin/jobs').expect(401);
    const res = await request(app)
      .get('/api/admin/jobs?type=VALIDATE')
      .set('x-api-key', KEY)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('active');
  });

  it('rejects generator overrides the generator cannot satisfy before starting a job', async () => {
    const res = await request(app)
      .post('/api/admin/generate')
      .set('x-api-key', KEY)
      .send({ profile: 'tiny', reset: true, overrides: { shipments: 600, trackingEvents: 9000 } })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Job.countDocuments({ type: 'GENERATE' })).toBe(0);
  });

  it('exposes non-sensitive system configuration only', async () => {
    const res = await request(app).get('/api/system/config').expect(200);
    expect(res.body.data.validation.rules).toBe(39);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/mongodb:\/\//);
  });
});
