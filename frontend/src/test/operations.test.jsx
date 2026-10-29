import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './renderApp.jsx';
import { ok, resetApiMock } from './mockApi.js';
import { ApiError, adminKeyStore } from '../api/apiClient.js';

vi.mock('../api/index.js', async () => (await import('./mockApi.js')).createApiMock());
const api = await import('../api/index.js');

beforeEach(() => resetApiMock(api));

const run = {
  runId: 'VAL-abc',
  status: 'PASS',
  finishedAt: '2026-10-27T08:54:44Z',
  durationMs: 63400,
  summary: { totalRecordsChecked: 777889, totalChecks: 26456735, passedChecks: 26456654, failedChecks: 81, intentionalAnomalies: 81, unexpectedErrors: 0, unexpectedWarnings: 0, anomalyCasesExpected: 60, anomalyCasesDetected: 60 },
  rules: [{ ruleId: 'ETA_FUTURE_DATA_LEAKAGE', description: 'Inputs available at prediction time', severity: 'CRITICAL', checked: 137334, failed: 8, intentional: 8, unexpected: 0 }],
  anomalyCoverage: [{ anomalyId: 'ANM-2026-0021', scenario: 'C_FUTURE_DATA_LEAKAGE', variant: 'FUTURE_EVENTS_USED', shipmentId: 'SHP-2026-900021', detected: true, missingRuleIds: [] }],
};

describe('data quality', () => {
  it('displays the real validation summary and violation rows', async () => {
    api.qualityApi.latest.mockImplementation(() => ok(run));
    api.qualityApi.violations.mockImplementation(() =>
      ok(
        [{ ruleId: 'ETA_FUTURE_DATA_LEAKAGE', severity: 'CRITICAL', entityType: 'ETAEstimate', recordId: 'ETA-SHP-2026-900021-20260412T0907Z', shipmentId: 'SHP-2026-900021', classification: 'INTENTIONAL_ANOMALY', anomalyId: 'ANM-2026-0021', expected: 'all inputs ingested <= predictionAt', actual: 'watermark.maxEventIngestedAt=…', recommendedCorrection: 'Recompute the snapshot' }],
        { total: 1, totalPages: 1, facets: { severity: ['CRITICAL'], ruleId: ['ETA_FUTURE_DATA_LEAKAGE'], entityType: ['ETAEstimate'] } },
      ),
    );
    renderApp('/data-quality');
    expect(await screen.findByText('Run PASSED')).toBeInTheDocument();
    expect(screen.getByText('777,889')).toBeInTheDocument();
    expect(screen.getByText('60/60 cases detected')).toBeInTheDocument();
    expect(await screen.findByText('Intentional · ANM-2026-0021')).toBeInTheDocument();
    expect(screen.getByText('Recompute the snapshot')).toBeInTheDocument();
  });

  it('filters violations by classification on the server', async () => {
    api.qualityApi.latest.mockImplementation(() => ok(run));
    const user = userEvent.setup();
    renderApp('/data-quality');
    await user.selectOptions(await screen.findByLabelText('Validation status'), 'UNEXPECTED');
    await waitFor(() => expect(api.qualityApi.violations).toHaveBeenLastCalledWith(expect.objectContaining({ classification: 'UNEXPECTED' }), expect.anything()));
  });

  it('offers to run validation when none exists, gated by the admin key', async () => {
    api.qualityApi.latest.mockRejectedValue(new ApiError({ message: 'No validation run yet', status: 404, code: 'NOT_FOUND' }));
    renderApp('/data-quality');
    expect(await screen.findByText('No validation run yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run validation now' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Enter it in Settings' })).toBeInTheDocument();
  });
});

describe('dataset generator', () => {
  it('validates the form and blocks an impossible configuration', async () => {
    adminKeyStore.set('test-admin-key-0123456789');
    const user = userEvent.setup();
    renderApp('/generator');
    const events = await screen.findByLabelText('Tracking events');
    await user.clear(events);
    await user.type(events, '999999');
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 5.2 and 6.8/);
    expect(screen.getByRole('button', { name: 'Start generation' })).toBeDisabled();
  });

  it('starts a full-volume job after confirmation and tracks real job progress to completion', async () => {
    adminKeyStore.set('test-admin-key-0123456789');
    api.generatorApi.start.mockImplementation(() => ok({ jobId: 'JOB-GENERATE-abc-123456', type: 'GENERATE', status: 'QUEUED' }));
    api.jobApi.get
      .mockImplementationOnce(() => ok({ jobId: 'JOB-GENERATE-abc-123456', type: 'GENERATE', status: 'RUNNING', progress: { phase: 'SHIPMENTS', processed: 25000, total: 50000, percent: 50 } }))
      .mockImplementation(() => ok({ jobId: 'JOB-GENERATE-abc-123456', type: 'GENERATE', status: 'SUCCEEDED', progress: { percent: 100 }, result: { datasetChecksum: 'abc', recordCounts: { shipments: { total: 50056 } } } }));
    const user = userEvent.setup();
    renderApp('/generator');
    await user.click(await screen.findByRole('radio', { name: /Full challenge/ }));
    expect(screen.getByLabelText('Shipments')).toHaveValue('50000');
    expect(screen.getByLabelText('Tracking events')).toHaveValue('300000');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start generation' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Start generation' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Replace the current dataset/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Replace and generate' }));
    expect(api.generatorApi.start).toHaveBeenCalledWith({ profile: 'full', seed: 20261022, batchSize: 1000, reset: true, resume: false });
    expect(await screen.findByText('25,000 / 50,000 (50%)')).toBeInTheDocument();
    expect(await screen.findByText('Succeeded', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('50,056')).toBeInTheDocument();
  });

  it('reports a failed job with its backend error', async () => {
    adminKeyStore.set('test-admin-key-0123456789');
    api.generatorApi.start.mockImplementation(() => ok({ jobId: 'JOB-GENERATE-def-654321', status: 'QUEUED' }));
    api.jobApi.get.mockImplementation(() => ok({ jobId: 'JOB-GENERATE-def-654321', type: 'GENERATE', status: 'FAILED', error: { code: 'TARGET_COUNT_MISMATCH', message: 'Baseline counts do not match targets' } }));
    const user = userEvent.setup();
    renderApp('/generator');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start generation' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Start generation' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace and generate' }));
    expect(await screen.findByText(/TARGET_COUNT_MISMATCH: Baseline counts do not match targets/)).toBeInTheDocument();
  });
});

describe('exports', () => {
  it('offers downloads only for files listed in a completed export', async () => {
    api.exportApi.list.mockImplementation(() =>
      ok([
        {
          label: 'latest',
          exportedAt: '2026-10-27T08:55:36Z',
          profile: 'full',
          seed: 20261022,
          datasetChecksum: 'e8a4',
          files: [
            { file: 'tracking_events.csv', format: 'csv', rows: 300367, bytes: 51064162, sha256: 'fb693cdced18f50b' },
            { file: 'dataset_manifest.json', format: 'json', rows: null, bytes: 1000, sha256: null },
          ],
        },
      ]),
    );
    renderApp('/exports');
    const link = await screen.findByRole('link', { name: 'Download tracking_events.csv' });
    expect(link).toHaveAttribute('href', '/api/exports/latest/files/tracking_events.csv');
    expect(screen.getByText('300,367')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Download/ })).toHaveLength(2);
  });

  it('shows an empty state and no download links when nothing has been exported', async () => {
    renderApp('/exports');
    expect(await screen.findByText('No completed exports on the server')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Download/ })).not.toBeInTheDocument();
  });
});
