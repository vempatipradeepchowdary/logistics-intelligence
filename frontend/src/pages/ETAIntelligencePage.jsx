import { useNavigate } from 'react-router-dom';
import { Activity, Crosshair, Gauge, Hash, ListChecks, Sigma } from 'lucide-react';
import { etaApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { PageHeader, Panel } from '../components/common/Panel.jsx';
import { MetricCard } from '../components/common/MetricCard.jsx';
import { QueryState } from '../components/common/States.jsx';
import { DataTable, Pagination } from '../components/common/DataTable.jsx';
import { FilterBar, SearchInput, SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { EtaLink, ShipmentLink } from '../components/common/Links.jsx';
import { CHART, ChartFrame, ColumnChart, HBarChart, hoursTick, PredictedActualScatter, TimeLineChart } from '../components/charts/ChartKit.jsx';
import { CONFIDENCE_TONE, ETA_PHASES } from '../utils/domain.js';
import { formatDate, formatDateTime, formatDuration, formatNumber, formatPercent, humanize } from '../utils/format.js';

const DEFAULTS = { page: 1, limit: 25, shipmentId: '', confidence: '', phase: '', evaluated: '', sort: '-predictionAt' };
const SHIPMENT_ID = /^SHP-\d{4}-\d{6}$/;

function SnapshotTable() {
  const [f, update, reset] = useUrlState(DEFAULTS);
  const shipmentOk = !f.shipmentId || SHIPMENT_ID.test(f.shipmentId);
  const params = { ...f, shipmentId: shipmentOk ? f.shipmentId : undefined, evaluated: f.evaluated || undefined, partition: 'BASELINE' };
  const list = useApiQuery(JSON.stringify(params), (signal) => etaApi.list(params, { signal }), { keepPreviousData: true });
  const activeCount = ['shipmentId', 'confidence', 'phase', 'evaluated'].filter((k) => f[k]).length;
  const columns = [
    { key: 'etaId', header: 'Snapshot', render: (e) => <EtaLink id={e.etaId} /> },
    { key: 'shipmentId', header: 'Shipment', render: (e) => <ShipmentLink id={e.shipmentId} />, hideBelow: 'md' },
    { key: 'predictionAt', header: 'Predicted at', sortKey: 'predictionAt', render: (e) => <span className="num">{formatDateTime(e.predictionAt)}</span> },
    { key: 'eta', header: 'Estimated arrival', render: (e) => <span className="num">{formatDateTime(e.estimatedArrivalAt)}</span> },
    { key: 'actual', header: 'Actual arrival', render: (e) => <span className="num">{formatDateTime(e.evaluation?.actualArrivalAt)}</span>, hideBelow: 'lg' },
    {
      key: 'abs',
      header: 'Abs. error',
      align: 'right',
      sortKey: 'absError',
      render: (e) => (e.evaluation ? formatDuration(e.evaluation.absErrorMinutes) : <span className="text-faint">pending</span>),
    },
    { key: 'phase', header: 'Position', render: (e) => <Tag>{humanize(e.position.phase)}</Tag>, hideBelow: 'xl' },
    { key: 'confidence', header: 'Confidence', render: (e) => <StatusBadge tone={CONFIDENCE_TONE[e.confidence]} value={e.confidence} />, hideBelow: 'sm' },
  ];
  return (
    <section className="card animate-in mt-4" aria-label="ETA snapshots">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13.5px] font-semibold text-ink">Prediction snapshots</h2>
        <p className="mt-0.5 text-[12px] text-muted">Immutable ETA records. Abs. error is shown only once the actual delivery is known.</p>
      </div>
      <FilterBar onReset={reset} activeCount={activeCount}>
        <SearchInput label="Shipment ID (exact)" value={f.shipmentId} onChange={(v) => update({ shipmentId: v.toUpperCase() })} placeholder="SHP-2026-000123" className="w-48" />
        <SelectFilter
          label="Outcome known"
          value={f.evaluated}
          onChange={(evaluated) => update({ evaluated })}
          options={[
            { value: 'true', label: 'Evaluated' },
            { value: 'false', label: 'Not yet delivered' },
          ]}
          className="w-40"
        />
        <SelectFilter label="Confidence" value={f.confidence} onChange={(confidence) => update({ confidence })} options={['HIGH', 'MEDIUM', 'LOW']} className="w-32" />
        <SelectFilter label="Position phase" value={f.phase} onChange={(phase) => update({ phase })} options={ETA_PHASES} className="w-44" />
      </FilterBar>
      {!shipmentOk && <p className="border-b border-line bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">Enter a full shipment ID to filter.</p>}
      <DataTable
        columns={columns}
        rows={list.data}
        rowKey={(e) => e.etaId}
        loading={list.loading}
        error={list.error}
        onRetry={list.refetch}
        sort={f.sort === '-absError' ? '-absError' : f.sort}
        onSortChange={(sort) => update({ sort: sort === 'absError' ? '-absError' : sort })}
        dense
      />
      <Pagination page={f.page} limit={f.limit} total={list.meta.total} totalPages={list.meta.totalPages} onPageChange={(page) => update({ page })} onLimitChange={(limit) => update({ limit })} />
    </section>
  );
}

export default function ETAIntelligencePage() {
  const navigate = useNavigate();
  const accuracy = useApiQuery('eta-acc-BASELINE', (signal) => etaApi.accuracy({ partition: 'BASELINE' }, { signal }));
  const breakdowns = useApiQuery('eta-break-BASELINE', (signal) => etaApi.breakdowns({ partition: 'BASELINE' }, { signal }));
  const totals = useApiQuery('eta-total', (signal) => etaApi.list({ limit: 1, partition: 'BASELINE' }, { signal }));
  const o = breakdowns.data?.overall;
  const defs = breakdowns.data?.definitions ?? {};
  const loading = breakdowns.loading && !breakdowns.data;

  return (
    <>
      <PageHeader
        title="ETA intelligence"
        description="Accuracy of the transparent rule-based ETA engine (eta-rules-v1.0.0), measured only on snapshots whose shipment has a known actual delivery time. Baseline partition."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Predictions" icon={Hash} loading={totals.loading} error={Boolean(totals.error)} value={formatNumber(totals.meta.total)} context="ETA snapshots stored" info="Every stored ETA snapshot, including those whose outcome is not yet known." />
        <MetricCard label="Evaluated" icon={ListChecks} loading={loading} error={Boolean(breakdowns.error)} value={formatNumber(o?.snapshots)} context="with known actual arrival" info="Snapshots whose shipment was delivered by the snapshot time; only these are scored." />
        <MetricCard label="MAE" icon={Gauge} loading={loading} error={Boolean(breakdowns.error)} value={formatDuration(o?.maeMinutes)} context="mean absolute error" info={defs.maeMinutes} />
        <MetricCard label="Median error" icon={Crosshair} loading={loading} error={Boolean(breakdowns.error)} value={formatDuration(o?.medianAbsErrorMinutes)} context="typical snapshot" info={defs.medianAbsErrorMinutes} />
        <MetricCard label="RMSE" icon={Sigma} loading={loading} error={Boolean(breakdowns.error)} value={formatDuration(o?.rmseMinutes)} context={o ? `bias ${formatDuration(o.biasMinutes, { signed: true })}` : ''} info={`${defs.rmseMinutes}. Bias: ${defs.biasMinutes}`} />
        <MetricCard label="SLA-call accuracy" icon={Activity} tone="good" loading={loading} error={Boolean(breakdowns.error)} value={formatPercent(o?.slaCallAccuracy)} context="predicted vs actual SLA outcome" info={defs.slaCallAccuracy} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Error by prediction horizon" subtitle="MAE grouped by time between prediction and actual delivery">
          <QueryState query={accuracy} isEmpty={(a) => !a?.byHorizon?.length}>
            {(a) => {
              const rows = a.byHorizon.map((h) => ({ horizon: h.horizon, mae: h.maeMinutes, median: h.p50AbsErrorMinutes, n: h.snapshots }));
              return (
                <ChartFrame height={240} summary={rows.map((r) => `${r.horizon}: MAE ${r.mae} min`).join('; ')} table={{ columns: ['Horizon', 'Snapshots', 'MAE (min)', 'Median (min)'], rows: rows.map((r) => [r.horizon, formatNumber(r.n), r.mae, r.median]) }}>
                  <ColumnChart
                    data={rows}
                    xKey="horizon"
                    valueFormatter={(v) => formatDuration(v)}
                    yFormatter={hoursTick}
                    series={[
                      { key: 'mae', name: 'MAE', color: CHART.primary },
                      { key: 'median', name: 'Median abs. error', color: CHART.primarySoft },
                    ]}
                  />
                </ChartFrame>
              );
            }}
          </QueryState>
        </Panel>
        <Panel title="Performance over time" subtitle="Weekly error by prediction week (UTC)">
          <QueryState query={breakdowns} isEmpty={(b) => !b?.overTime?.length}>
            {(b) => (
              <ChartFrame height={240} summary={`Weekly MAE across ${b.overTime.length} weeks.`} table={{ columns: ['Week of', 'Snapshots', 'MAE (min)', 'Median (min)', 'Call accuracy'], rows: b.overTime.map((w) => [w.weekStart, formatNumber(w.snapshots), w.maeMinutes, w.medianAbsErrorMinutes, formatPercent(w.slaCallAccuracy)]) }}>
                <TimeLineChart
                  data={b.overTime}
                  xKey="weekStart"
                  xFormatter={(d) => formatDate(`${d}T00:00:00Z`, { year: false })}
                  valueFormatter={(v) => formatDuration(v)}
                  yFormatter={hoursTick}
                  series={[
                    { key: 'maeMinutes', name: 'MAE', color: CHART.primary },
                    { key: 'medianAbsErrorMinutes', name: 'Median abs. error', color: CHART.good },
                  ]}
                />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
        <Panel title="Error by carrier" subtitle="MAE per carrier; click a bar to see its shipments">
          <QueryState query={breakdowns} isEmpty={(b) => !b?.byCarrier?.length}>
            {(b) => (
              <ChartFrame height={b.byCarrier.length * 30 + 30} summary={b.byCarrier.map((c) => `${c.carrierId}: ${c.maeMinutes} min`).join(', ')} table={{ columns: ['Carrier', 'Snapshots', 'MAE', 'Median', 'RMSE', 'Call acc.'], rows: b.byCarrier.map((c) => [c.carrierId, formatNumber(c.snapshots), c.maeMinutes, c.medianAbsErrorMinutes, c.rmseMinutes, formatPercent(c.slaCallAccuracy)]) }}>
                <HBarChart data={b.byCarrier} labelKey="carrierId" valueKey="maeMinutes" name="MAE" valueFormatter={(v) => formatDuration(v)} axisFormatter={hoursTick} labelWidth={70} onBarClick={(c) => navigate(`/shipments?carrierId=${c.carrierId}`)} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
        <Panel title="Error by service level" subtitle="MAE per service level">
          <QueryState query={breakdowns} isEmpty={(b) => !b?.byServiceLevel?.length}>
            {(b) => (
              <ChartFrame height={b.byServiceLevel.length * 34 + 30} summary={b.byServiceLevel.map((c) => `${c.serviceLevelId}: ${c.maeMinutes} min`).join(', ')} table={{ columns: ['Service level', 'Snapshots', 'MAE', 'Median', 'RMSE', 'Call acc.'], rows: b.byServiceLevel.map((c) => [c.serviceLevelId, formatNumber(c.snapshots), c.maeMinutes, c.medianAbsErrorMinutes, c.rmseMinutes, formatPercent(c.slaCallAccuracy)]) }}>
                <HBarChart data={b.byServiceLevel} labelKey="serviceLevelId" valueKey="maeMinutes" name="MAE" valueFormatter={(v) => formatDuration(v)} axisFormatter={hoursTick} labelWidth={96} onBarClick={(c) => navigate(`/shipments?serviceLevelId=${c.serviceLevelId}`)} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
        <Panel title="Predicted vs actual time to delivery" subtitle="Deterministic sample of evaluated snapshots; dashed line = perfect prediction. Click a point to inspect it." className="xl:col-span-2">
          <QueryState query={breakdowns} isEmpty={(b) => !b?.predictedVsActualSample?.length}>
            {(b) => (
              <ChartFrame
                height={340}
                summary={`Scatter of ${b.predictedVsActualSample.length} sampled snapshots; ${b.sampleMethod}.`}
                table={{ columns: ['Snapshot', 'Predicted (h)', 'Actual (h)'], rows: b.predictedVsActualSample.map((p) => [p.etaId, p.predictedHours, p.actualHours]) }}
                actions={<span className="text-[11px] text-faint">{b.sampleMethod}</span>}
              >
                <PredictedActualScatter data={b.predictedVsActualSample} onPointClick={(p) => navigate(`/eta/${encodeURIComponent(p.etaId)}`)} />
              </ChartFrame>
            )}
          </QueryState>
        </Panel>
      </div>
      <SnapshotTable />
    </>
  );
}
