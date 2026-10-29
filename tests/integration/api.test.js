import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, ensureTinyDataset } from '../helpers/db.js';
import { createApp } from '../../src/app.js';
import { Job, ValidationRun } from '../../src/models/index.js';

const KEY = process.env.ADMIN_API_KEY;
let app;

beforeAll(async () => {
  await connectTestDb();
  await ensureTinyDataset();
  app = createApp();
});
afterAll(async () => {
  await Job.deleteMany({});
  await disconnectTestDb();
});

const waitForJob = async (path, timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get(path).set('x-api-key', KEY);
    if (['SUCCEEDED', 'FAILED'].includes(res.body.data?.status) || Date.now() > deadline)
      return res;
    await new Promise((r) => setTimeout(r, 500));
  }
};

describe('health', () => {
  it('reports service and database health', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', database: { state: 'connected' } },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('shipments', () => {
  it('paginates with a consistent envelope', async () => {
    const res = await request(app).get('/api/shipments?limit=5&page=2').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta).toMatchObject({ page: 2, limit: 5, total: 628, totalPages: 126 });
    expect(res.body.data[0].shipmentId).toBe('SHP-2026-000006');
    expect(res.body.data[0]._id).toBeUndefined();
  });

  it('filters by indexed fields and searches by business-ID prefix', async () => {
    const res = await request(app)
      .get('/api/shipments?status=DELIVERED&carrierId=CAR-002&limit=50')
      .expect(200);
    expect(res.body.data.every((s) => s.status === 'DELIVERED' && s.carrierId === 'CAR-002')).toBe(
      true,
    );
    const search = await request(app).get('/api/shipments?q=shp-2026-9000&limit=200').expect(200);
    expect(search.body.meta.total).toBe(28);
    expect(search.body.data.every((s) => s.partition === 'ANOMALY')).toBe(true);
  });

  it('validates query parameters and blocks operator injection', async () => {
    const bad = await request(app).get('/api/shipments?limit=500').expect(400);
    expect(bad.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    await request(app).get('/api/shipments?status[$ne]=X').expect(400);
    await request(app).get('/api/shipments?q=.*').expect(400);
  });

  it('returns details, events, ETA snapshots and timeline', async () => {
    const id = 'SHP-2026-000010';
    const detail = await request(app).get(`/api/shipments/${id}`).expect(200);
    expect(detail.body.data.shipment.shipmentId).toBe(id);
    expect(detail.body.data.legs.length).toBeGreaterThan(0);
    expect(detail.body.data.evaluation.groundTruth.shipmentId).toBe(id);

    const events = await request(app).get(`/api/shipments/${id}/events`).expect(200);
    const times = events.body.data.map((e) => Date.parse(e.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));

    const asOf = events.body.data[1].ingestedAt;
    const partial = await request(app).get(`/api/shipments/${id}/events?asOf=${asOf}`).expect(200);
    expect(partial.body.data.every((e) => e.ingestedAt <= asOf)).toBe(true);
    expect(partial.body.data.length).toBeLessThan(events.body.data.length);

    const etas = await request(app).get(`/api/shipments/${id}/eta`).expect(200);
    expect(etas.body.data.length).toBeGreaterThan(0);
    for (const e of etas.body.data)
      expect(Date.parse(e.watermark.maxEventIngestedAt ?? 0)).toBeLessThanOrEqual(
        Date.parse(e.predictionAt),
      );

    const timeline = await request(app).get(`/api/shipments/${id}/timeline`).expect(200);
    expect(timeline.body.data.entries[0].kind).toBe('CREATED');
  });

  it('returns 400 for malformed IDs and 404 for unknown shipments/routes', async () => {
    await request(app).get('/api/shipments/not-an-id').expect(400);
    const missing = await request(app).get('/api/shipments/SHP-2026-123456').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    await request(app).get('/api/nope').expect(404);
  });
});

describe('analytics', () => {
  it('summarises the dataset and delays', async () => {
    const summary = await request(app).get('/api/analytics/summary').expect(200);
    expect(summary.body.data.collections).toMatchObject({
      shipments: 600,
      tracking_events: 3600,
      facilities: 100,
    });
    const delays = await request(app).get('/api/analytics/delays').expect(200);
    expect(delays.body.data.onTimeRate).toBeGreaterThan(0.5);
    expect(Array.isArray(delays.body.data.reasons)).toBe(true);
  });

  it('computes ETA accuracy metrics', async () => {
    const res = await request(app).get('/api/analytics/eta-accuracy').expect(200);
    expect(res.body.data.overall.snapshots).toBeGreaterThan(0);
    expect(res.body.data.byHorizon.length).toBeGreaterThan(0);
  });
});

describe('admin operations', () => {
  it('requires the admin key', async () => {
    const res = await request(app).post('/api/admin/validate').send({}).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates bodies, rejects unsafe export labels, malformed JSON and oversized payloads', async () => {
    await request(app)
      .post('/api/admin/generate')
      .set('x-api-key', KEY)
      .send({ profile: 'huge' })
      .expect(400);
    await request(app)
      .post('/api/admin/export')
      .set('x-api-key', KEY)
      .send({ label: '../../etc' })
      .expect(400);
    const bad = await request(app)
      .post('/api/admin/export')
      .set('x-api-key', KEY)
      .set('content-type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    await request(app)
      .post('/api/admin/export')
      .set('x-api-key', KEY)
      .send({ label: 'x'.repeat(200_000) })
      .expect(413);
  });

  it('runs validation as a background job and exposes the data-quality report', async () => {
    const start = await request(app)
      .post('/api/admin/validate')
      .set('x-api-key', KEY)
      .send({})
      .expect(202);
    expect(start.body.data.status).toBe('QUEUED');
    // A second data job is refused while the first is active (bounded concurrency).
    await request(app).post('/api/admin/export').set('x-api-key', KEY).send({}).expect(409);
    const done = await waitForJob(start.body.meta.statusUrl);
    expect(done.body.data.status).toBe('SUCCEEDED');
    expect(done.body.data.result.status).toBe('PASS');
    const dq = await request(app).get('/api/analytics/data-quality').expect(200);
    expect(dq.body.data.summary.unexpectedErrors).toBe(0);
    expect(await ValidationRun.countDocuments()).toBeGreaterThan(0);
  });

  it('runs an export job and reports its status', async () => {
    const start = await request(app)
      .post('/api/admin/export')
      .set('x-api-key', KEY)
      .send({ label: 'api-test' })
      .expect(202);
    expect(start.body.meta.statusUrl).toMatch(/^\/api\/admin\/exports\/JOB-EXPORT-/);
    const done = await waitForJob(start.body.meta.statusUrl);
    expect(done.body.data.status).toBe('SUCCEEDED');
    expect(done.body.data.result.files.find((f) => f.file === 'tracking_events.csv').rows).toBe(
      3783,
    );
    await request(app)
      .get(`/api/admin/exports/${start.body.data.jobId.replace('EXPORT', 'VALIDATE')}`)
      .set('x-api-key', KEY)
      .expect(404);
  });
});
