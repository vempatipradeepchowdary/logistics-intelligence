import { describe, expect, it } from 'vitest';
import { formatBytes, formatDateTime, formatDuration, formatNumber, formatPercent, toIsoEnd, toIsoStart } from './format.js';
import { generatorSchema, PRESETS, toGenerateRequest } from '../components/generator/generatorSchema.js';
import { cleanParams, normalizeError } from '../api/apiClient.js';

describe('formatting', () => {
  it('formats ETA error durations', () => {
    expect(formatDuration(395)).toBe('6h 35m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(2 * 1440 + 125)).toBe('2d 2h');
    expect(formatDuration(-258, { signed: true })).toBe('−4h 18m');
    expect(formatDuration(30, { signed: true })).toBe('+30m');
    expect(formatDuration(null)).toBe('—');
  });

  it('formats numbers, percentages and sizes', () => {
    expect(formatNumber(300000)).toBe('300,000');
    expect(formatNumber(132354, { compact: true })).toBe('132.4K');
    expect(formatPercent(0.959)).toBe('95.9%');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatBytes(51064162)).toBe('48.7 MB');
  });

  it('formats timestamps in UTC', () => {
    expect(formatDateTime('2026-03-04T14:05:00.000Z')).toBe('Mar 04, 14:05');
    expect(formatDateTime('2026-03-04T14:05:00.000Z', { year: true })).toBe('Mar 04 2026, 14:05');
    expect(formatDateTime(undefined)).toBe('—');
    expect(toIsoStart('2026-01-02')).toBe('2026-01-02T00:00:00.000Z');
    expect(toIsoEnd('2026-01-02')).toBe('2026-01-02T23:59:59.999Z');
  });
});

describe('generator form validation', () => {
  const base = { profile: 'full', seed: 20261022, batchSize: 1000, mode: 'reset', ...PRESETS.full };

  it('accepts the full challenge preset', () => {
    expect(generatorSchema.safeParse(base).success).toBe(true);
    expect(toGenerateRequest(base)).toEqual({ profile: 'full', seed: 20261022, batchSize: 1000, reset: true, resume: false });
  });

  it('rejects an events-per-shipment ratio the generator cannot calibrate', () => {
    const r = generatorSchema.safeParse({ ...base, trackingEvents: 900000 });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(['trackingEvents']);
    expect(r.error.issues[0].message).toMatch(/between 5.2 and 6.8/);
  });

  it('rejects out-of-range values', () => {
    expect(generatorSchema.safeParse({ ...base, shipments: 10 }).success).toBe(false);
    expect(generatorSchema.safeParse({ ...base, seed: -1 }).success).toBe(false);
  });

  it('sends only values that differ from the preset as overrides', () => {
    expect(toGenerateRequest({ ...base, profile: 'small', ...PRESETS.small, shipments: 6000, trackingEvents: 36000, mode: 'resume' })).toEqual({
      profile: 'small',
      seed: 20261022,
      batchSize: 1000,
      reset: false,
      resume: true,
      overrides: { shipments: 6000, trackingEvents: 36000 },
    });
  });
});

describe('API client helpers', () => {
  it('drops empty filter values', () => {
    expect(cleanParams({ a: 1, b: '', c: undefined, d: null, e: 'x' })).toEqual({ a: 1, e: 'x' });
  });

  it('normalises backend, network and cancellation errors', () => {
    const backend = normalizeError({ response: { status: 409, data: { error: { code: 'JOB_CONFLICT', message: 'busy', details: [{ jobId: 'J' }] } } } });
    expect(backend).toMatchObject({ status: 409, code: 'JOB_CONFLICT', message: 'busy' });
    expect(normalizeError(new Error('socket hang up'))).toMatchObject({ code: 'NETWORK_ERROR', network: true });
    expect(normalizeError({ name: 'CanceledError' })).toMatchObject({ canceled: true });
  });
});
