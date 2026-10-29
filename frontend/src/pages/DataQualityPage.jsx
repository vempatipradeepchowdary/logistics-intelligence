import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardCheck, FlaskConical, ListChecks, OctagonAlert, Play, ShieldCheck, ShieldX } from 'lucide-react';
import { qualityApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useUrlState } from '../hooks/useUrlState.js';
import { useJobPoller } from '../hooks/useJobPoller.js';
import { useApp } from '../context/AppContext.jsx';
import { PageHeader, Panel } from '../components/common/Panel.jsx';
import { MetricCard } from '../components/common/MetricCard.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../components/common/States.jsx';
import { Button } from '../components/common/Button.jsx';
import { ConfirmDialog } from '../components/common/ConfirmDialog.jsx';
import { DataTable, Pagination } from '../components/common/DataTable.jsx';
import { FilterBar, SearchInput, SelectFilter } from '../components/common/Filters.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { Mono, ShipmentLink } from '../components/common/Links.jsx';
import { JobProgress } from '../components/jobs/JobProgress.jsx';
import { AdminKeyNotice } from '../components/jobs/AdminGate.jsx';
import { RULE_GROUPS, SEVERITY_TONE } from '../utils/domain.js';
import { formatDateTime, formatNumber, humanize } from '../utils/format.js';

const DEFAULTS = { page: 1, limit: 25, severity: '', ruleId: '', entityType: '', classification: '', q: '' };

function ViolationsTable({ runId }) {
  const [f, update, reset] = useUrlState(DEFAULTS);
  const list = useApiQuery(`${runId}-${JSON.stringify(f)}`, (signal) => qualityApi.violations(f, { signal }), { keepPreviousData: true });
  const facets = list.meta.facets ?? {};
  const activeCount = ['severity', 'ruleId', 'entityType', 'classification', 'q'].filter((k) => f[k]).length;
  const columns = [
    { key: 'ruleId', header: 'Rule', render: (v) => <Mono>{v.ruleId}</Mono> },
    { key: 'severity', header: 'Severity', render: (v) => <StatusBadge tone={SEVERITY_TONE[v.severity]} value={v.severity} /> },
    { key: 'entity', header: 'Entity', render: (v) => <Tag>{v.entityType}</Tag>, hideBelow: 'md' },
    {
      key: 'record',
      header: 'Record',
      render: (v) => (
        <span className="flex flex-col leading-4">
          <Mono>{v.recordId}</Mono>
          {v.shipmentId && v.shipmentId !== v.recordId && <ShipmentLink id={v.shipmentId} />}
        </span>
      ),
    },
    {
      key: 'class',
      header: 'Status',
      render: (v) =>
        v.classification === 'UNEXPECTED' ? (
          <StatusBadge tone="crit" label="Unexpected defect" />
        ) : (
          <StatusBadge tone="info" label={`Intentional · ${v.anomalyId}`} />
        ),
    },
    { key: 'expected', header: 'Expected', render: (v) => <span className="block max-w-56 whitespace-normal text-ink-2">{v.expected}</span>, hideBelow: 'xl' },
    { key: 'actual', header: 'Actual violation', render: (v) => <span className="block max-w-72 whitespace-normal text-ink">{v.actual}</span> },
    { key: 'fix', header: 'Suggested correction', render: (v) => <span className="block max-w-64 whitespace-normal text-muted">{v.recommendedCorrection}</span>, hideBelow: 'lg' },
  ];
  return (
    <section className="card animate-in mt-4" aria-label="Validation results">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13.5px] font-semibold text-ink">Validation results</h2>
        <p className="mt-0.5 text-[12px] text-muted">Every failed check of the latest run with its expected condition, the actual violation and the recommended correction.</p>
      </div>
      <FilterBar onReset={reset} activeCount={activeCount}>
        <SearchInput label="Record or shipment ID" value={f.q} onChange={(q) => update({ q })} placeholder="EVT-… or SHP-…" pattern={/^[A-Za-z0-9-]{0,40}$/} className="w-52" />
        <SelectFilter label="Severity" value={f.severity} onChange={(severity) => update({ severity })} options={facets.severity ?? []} className="w-32" />
        <SelectFilter label="Rule" value={f.ruleId} onChange={(ruleId) => update({ ruleId })} options={facets.ruleId ?? []} format={(x) => x} className="w-64" />
        <SelectFilter label="Entity" value={f.entityType} onChange={(entityType) => update({ entityType })} options={facets.entityType ?? []} format={(x) => x} className="w-40" />
        <SelectFilter
          label="Validation status"
          value={f.classification}
          onChange={(classification) => update({ classification })}
          options={[
            { value: 'INTENTIONAL_ANOMALY', label: 'Intentional anomaly' },
            { value: 'UNEXPECTED', label: 'Unexpected defect' },
          ]}
          className="w-44"
        />
      </FilterBar>
      <DataTable columns={columns} rows={list.data} rowKey={(v, i) => `${v.ruleId}-${v.recordId}-${i}`} loading={list.loading} error={list.error} onRetry={list.refetch} emptyTitle="No failed checks match these filters" />
      <Pagination page={f.page} limit={f.limit} total={list.meta.total} totalPages={list.meta.totalPages} onPageChange={(page) => update({ page })} onLimitChange={(limit) => update({ limit })} />
    </section>
  );
}

function RunValidation({ onFinished }) {
  const { hasAdminKey } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState(null);
  const { job, error, done } = useJobPoller(jobId, {
    onFinish: (j) => {
      if (j.status === 'SUCCEEDED') {
        toast.success(`Validation ${j.result?.status}: ${formatNumber(j.result?.summary?.failedChecks)} failed checks`);
        onFinished();
      } else toast.error(`Validation job failed: ${j.error?.message}`);
    },
  });
  const running = Boolean(jobId) && !done;
  const start = async () => {
    setStarting(true);
    try {
      const { data } = await qualityApi.runValidation({});
      setJobId(data.jobId);
      toast.info('Validation job started');
      setConfirm(false);
    } catch (err) {
      toast.error(err.message);
      setConfirm(false);
    } finally {
      setStarting(false);
    }
  };
  return (
    <Panel title="Run validation" subtitle="Runs the standalone validation engine as a background job on the backend">
      <div className="space-y-3">
        <AdminKeyNotice />
        <Button variant="primary" icon={Play} onClick={() => setConfirm(true)} disabled={!hasAdminKey || running} loading={starting}>
          {running ? 'Validation running…' : 'Run validation now'}
        </Button>
        <JobProgress job={job} pollError={error} />
      </div>
      <ConfirmDialog open={confirm} title="Run full validation?" confirmLabel="Start validation" onConfirm={start} onCancel={() => setConfirm(false)} busy={starting}>
        All validation rules run over every record and every ETA snapshot is recomputed. At full volume this takes about a minute; only one data job can run at a time.
      </ConfirmDialog>
    </Panel>
  );
}

export default function DataQualityPage() {
  const latest = useApiQuery('dq-latest', (signal) => qualityApi.latest({}, { signal }), { keepPreviousData: true });
  const run = latest.data;

  if (latest.loading && !run) return <LoadingBlock rows={10} label="Loading validation report" />;
  if (latest.error && latest.error.status !== 404) return <ErrorState error={latest.error} onRetry={latest.refetch} />;

  if (!run) {
    return (
      <>
        <PageHeader title="Data quality" description="Validation results from the standalone validation engine." />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel>
            <EmptyState icon={ClipboardCheck} title="No validation run yet" description="Run validation to check schemas, references, timestamps, lifecycles, ETA leakage and derived values." />
          </Panel>
          <RunValidation onFinished={latest.refetch} />
        </div>
      </>
    );
  }

  const s = run.summary;
  const groupCounts = RULE_GROUPS.map((g) => ({
    ...g,
    failed: run.rules.filter((r) => g.match(r.ruleId)).reduce((n, r) => n + r.failed, 0),
    unexpected: run.rules.filter((r) => g.match(r.ruleId)).reduce((n, r) => n + r.unexpected, 0),
  }));
  const pass = run.status === 'PASS';

  return (
    <>
      <PageHeader
        title="Data quality"
        description="Results of the latest validation run. Intentionally injected challenge anomalies are reported separately from unexpected defects; nothing is suppressed."
        meta={
          <>
            <StatusBadge tone={pass ? 'good' : 'crit'} label={`Run ${pass ? 'PASSED' : 'FAILED'}`} />
            <Mono>{run.runId}</Mono>
            <span className="num">
              finished {formatDateTime(run.finishedAt, { year: true, seconds: true })} UTC · {(run.durationMs / 1000).toFixed(1)}s
            </span>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Records checked" icon={ListChecks} value={formatNumber(s.totalRecordsChecked)} context={`${formatNumber(s.totalChecks)} checks`} info="Records scanned across all dataset collections; each record is evaluated by several rules." />
        <MetricCard label="Passed checks" icon={CheckCircle2} tone="good" value={formatNumber(s.passedChecks)} context={`${((s.passedChecks / s.totalChecks) * 100).toFixed(4)}% of checks`} />
        <MetricCard label="Failed checks" icon={OctagonAlert} value={formatNumber(s.failedChecks)} context="all severities" />
        <MetricCard label="Intentional anomalies" icon={FlaskConical} value={formatNumber(s.intentionalAnomalies)} context={`${s.anomalyCasesDetected}/${s.anomalyCasesExpected} cases detected`} info="Failures on shipments carrying a labelled anomaly case whose expected rules include the failing rule." />
        <MetricCard label="Unexpected errors" icon={ShieldX} tone={s.unexpectedErrors ? 'crit' : 'good'} value={formatNumber(s.unexpectedErrors)} context="ERROR / CRITICAL" info="Failures not explained by any labelled anomaly. A run passes only when this is zero and every anomaly is detected." />
        <MetricCard label="Unexpected warnings" icon={ShieldCheck} tone={s.unexpectedWarnings ? 'warn' : 'good'} value={formatNumber(s.unexpectedWarnings)} context="WARNING / INFO" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {groupCounts.map((g) => (
          <div key={g.key} className="card px-4 py-3">
            <p className="text-[12px] font-medium text-muted">{g.label}</p>
            <p className="num mt-1 text-[20px] font-semibold text-ink">{formatNumber(g.failed)}</p>
            <p className="text-[11.5px] text-muted">{g.unexpected ? `${g.unexpected} unexpected` : 'all failures intentional'}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Rules" subtitle={`${run.rules.length} rules; failures split into intentional and unexpected`} className="xl:col-span-2" bodyClassName="">
          <div className="max-h-[440px] overflow-y-auto">
            <DataTable
              dense
              columns={[
                { key: 'ruleId', header: 'Rule', render: (r) => <span className="block max-w-80 whitespace-normal"><Mono>{r.ruleId}</Mono><span className="block text-[11.5px] text-muted">{r.description}</span></span> },
                { key: 'severity', header: 'Severity', render: (r) => <StatusBadge tone={SEVERITY_TONE[r.severity]} value={r.severity} />, hideBelow: 'sm' },
                { key: 'checked', header: 'Checked', align: 'right', render: (r) => formatNumber(r.checked) },
                { key: 'failed', header: 'Failed', align: 'right', render: (r) => formatNumber(r.failed) },
                { key: 'intentional', header: 'Intentional', align: 'right', render: (r) => formatNumber(r.intentional), hideBelow: 'md' },
                { key: 'unexpected', header: 'Unexpected', align: 'right', render: (r) => (r.unexpected ? <span className="font-semibold text-crit-ink">{formatNumber(r.unexpected)}</span> : 0) },
              ]}
              rows={run.rules}
              rowKey={(r) => r.ruleId}
            />
          </div>
        </Panel>
        <div className="flex flex-col gap-4">
          <RunValidation onFinished={latest.refetch} />
          <Panel title="Anomaly detection coverage" subtitle="Each labelled challenge anomaly and whether every expected rule caught it">
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {run.anomalyCoverage.map((c) => (
                <li key={c.anomalyId} className="flex items-start justify-between gap-2 py-2 text-[12px]">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <Mono>{c.anomalyId}</Mono>
                      <ShipmentLink id={c.shipmentId} />
                    </span>
                    <span className="block truncate text-muted">
                      {humanize(c.scenario.slice(2))} · {humanize(c.variant)}
                    </span>
                  </span>
                  <StatusBadge tone={c.detected ? 'good' : 'crit'} label={c.detected ? 'Detected' : `Missed ${c.missingRuleIds.join(', ')}`} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      <ViolationsTable runId={run.runId} />
      <p className="mt-3 text-[11.5px] text-faint">
        Issue resolution states are not tracked by the backend; a finding disappears only when a new validation run no longer detects it.
      </p>
    </>
  );
}
