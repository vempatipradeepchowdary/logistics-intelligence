import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './renderApp.jsx';
import { fixtures, ok, resetApiMock } from './mockApi.js';
import { ApiError } from '../api/apiClient.js';

vi.mock('../api/index.js', async () => (await import('./mockApi.js')).createApiMock());
const api = await import('../api/index.js');

beforeEach(() => resetApiMock(api));

describe('navigation & shell', () => {
  it('renders the dashboard with KPIs from the analytics API', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Operations overview' })).toBeInTheDocument();
    expect(await screen.findByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('95.9%')).toBeInTheDocument();
    expect(screen.getByText('6h 35m')).toBeInTheDocument();
    expect(api.analyticsApi.summary).toHaveBeenCalledWith({ partition: 'BASELINE' }, expect.anything());
  });

  it('shows the real backend health state', async () => {
    renderApp('/');
    expect(await screen.findByText('API online')).toBeInTheDocument();
  });

  it('marks the backend offline when health fails', async () => {
    api.healthApi.get.mockRejectedValueOnce(new ApiError({ message: 'Cannot reach the backend API', code: 'NETWORK_ERROR', network: true }));
    renderApp('/settings');
    expect(await screen.findByText('API offline')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i);
  });

  it('navigates via the sidebar and updates breadcrumbs', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: 'Operations overview' });
    const sidebar = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(sidebar).getByRole('link', { name: 'Shipments' }));
    expect(await screen.findByRole('heading', { name: 'Shipments' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/shipments');
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Shipments')).toHaveAttribute('aria-current', 'page');
  });

  it('opens and closes the mobile navigation drawer with the keyboard', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const open = await screen.findByRole('button', { name: 'Open navigation' });
    open.focus();
    await user.keyboard('{Enter}');
    const drawer = screen.getByRole('complementary', { name: 'Mobile navigation' });
    expect(drawer.className).toContain('translate-x-0');
    await user.click(within(drawer).getByRole('button', { name: 'Close navigation' }));
    expect(drawer.className).toContain('-translate-x-full');
  });

  it('global search jumps straight to a shipment by exact ID', async () => {
    const user = userEvent.setup();
    api.shipmentApi.get.mockReturnValue(new Promise(() => {}));
    const { router } = renderApp('/');
    await user.type(await screen.findByLabelText('Search shipments by ID'), 'shp-2026-000123{Enter}');
    expect(router.state.location.pathname).toBe('/shipments/SHP-2026-000123');
  });

  it('renders a not-found page for unknown routes', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('shipments table', () => {
  it('lists shipments with status and evaluation labels', async () => {
    renderApp('/shipments');
    expect(await screen.findByRole('link', { name: 'SHP-2026-000001' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(within(table).getByText('On time')).toBeInTheDocument();
  });

  it('applies debounced search and filters server-side and keeps them in the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/shipments');
    await screen.findByRole('link', { name: 'SHP-2026-000001' });
    await user.type(screen.getByLabelText('Shipment ID'), 'SHP-2026-0001');
    await waitFor(() => expect(api.shipmentApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'SHP-2026-0001', page: 1 }), expect.anything()));
    await user.selectOptions(screen.getByLabelText('Status'), 'IN_TRANSIT');
    await waitFor(() => expect(api.shipmentApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'IN_TRANSIT' }), expect.anything()));
    expect(router.state.location.search).toContain('status=IN_TRANSIT');
    expect(router.state.location.search).toContain('q=SHP-2026-0001');
  });

  it('paginates through the server and sorts by column', async () => {
    api.shipmentApi.list.mockImplementation((params) => ok([fixtures.shipment(`SHP-2026-00000${params.page}`)], { page: params.page, limit: 25, total: 60, totalPages: 3 }));
    const user = userEvent.setup();
    renderApp('/shipments');
    await screen.findByRole('link', { name: 'SHP-2026-000001' });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('link', { name: 'SHP-2026-000002' })).toBeInTheDocument();
    expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Planned delivery/ }));
    await waitFor(() => expect(api.shipmentApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ sort: '-promisedDeliveryAt', page: 1 }), expect.anything()));
  });

  it('shows loading skeletons, then an error state with a working retry', async () => {
    api.shipmentApi.list
      .mockRejectedValueOnce(new ApiError({ message: 'Request failed with status 500', status: 500, code: 'INTERNAL_ERROR' }))
      .mockImplementationOnce(() => ok([fixtures.shipment('SHP-2026-000009')], { total: 1, totalPages: 1 }));
    const user = userEvent.setup();
    renderApp('/shipments');
    expect(screen.queryByRole('link', { name: /SHP-/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Request failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'SHP-2026-000009' })).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    api.shipmentApi.list.mockImplementation(() => ok([], { total: 0, totalPages: 0 }));
    renderApp('/shipments?status=EXCEPTION');
    expect(await screen.findByText('No shipments match these filters')).toBeInTheDocument();
  });
});

describe('shipment detail', () => {
  it('renders overview, legs, ETA and separates evaluation data', async () => {
    const s = { ...fixtures.shipment('SHP-2026-000357'), plannedPickupAt: '2026-01-01T07:25:00Z', createdAt: '2026-01-01T04:25:00Z', plannedRouteId: 'RTE-00294', currentRouteId: 'RTE-00294', distanceZone: 'Z3', weightKg: 2.9, pieces: 1, dataAsOf: '2026-05-01T00:00:00Z' };
    api.shipmentApi.get.mockImplementation(() =>
      ok({
        shipment: s,
        legs: [{ legId: 'LEG-SHP-2026-000357-01', sequence: 1, fromFacilityId: 'FAC-031', toFacilityId: 'FAC-003', status: 'COMPLETED', transportMode: 'GROUND', plannedDwellMinutes: 40, plannedTransitMinutes: 71, actualDwellMinutes: 50, actualTransitMinutes: 71, actualTransitMinutes2: 0, delayBreakdown: { queueMinutes: 10, weatherMinutes: 0, carrierMinutes: 0 }, actualArrivalAt: '2026-01-01T10:00:00Z' }],
        facilities: [{ facilityId: 'FAC-031', city: 'Dallas' }, { facilityId: 'FAC-003', city: 'Dallas' }, { facilityId: 'FAC-050', city: 'Austin' }],
        disruptions: [],
        validation: { runId: 'VAL-1', violations: [] },
        counts: { events: 1, etaSnapshots: 1 },
        evaluation: { groundTruth: { delayClass: 'ON_TIME', deliveryOutcome: 'DELIVERED', actualDeliveredAt: '2026-01-04T13:16:00Z', delayMinutes: 0, rationale: 'R1: delivered on or before the SLA deadline' }, delayReasons: [] },
      }),
    );
    api.shipmentApi.etas.mockImplementation(() =>
      ok([{ etaId: 'ETA-SHP-2026-000357-20260103T0425Z', predictionAt: '2026-01-03T04:25:00Z', estimatedArrivalAt: '2026-01-04T12:30:00Z', confidence: 'HIGH', position: { phase: 'AT_FACILITY' }, algorithmVersion: 'eta-rules-v1.0.0', evaluation: { errorMinutes: -46 } }]),
    );
    api.shipmentApi.timeline.mockImplementation(() =>
      ok({ entries: [{ at: '2026-01-01T08:03:00Z', kind: 'EVENT', status: 'PICKED_UP', legal: true, transition: 'CREATED -> PICKED_UP', detail: { eventId: 'EVT-SHP-2026-000357-000001', eventType: 'PICKED_UP', facilityId: 'FAC-031', ingestedAt: '2026-01-01T15:10:00Z' } }] }),
    );
    renderApp('/shipments/SHP-2026-000357');
    expect(await screen.findByText('Shipment overview')).toBeInTheDocument();
    expect(screen.getByText('Route progression')).toBeInTheDocument();
    expect(screen.getByText('Evaluation (ground truth)')).toBeInTheDocument();
    expect(await screen.findByText('Jan 04 2026, 12:30')).toBeInTheDocument();
    expect(await screen.findByText(/Late arrival \+7h 07m/)).toBeInTheDocument();
    expect(screen.getByText('No validation findings for this shipment.')).toBeInTheDocument();
  });
});
