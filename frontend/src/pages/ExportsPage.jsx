import { useState } from 'react';
import { toast } from 'sonner';
import { Download, FileJson, FileSpreadsheet, Play } from 'lucide-react';
import { exportApi, jobApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useJobPoller } from '../hooks/useJobPoller.js';
import { useApp } from '../context/AppContext.jsx';
import { PageHeader, Panel } from '../components/common/Panel.jsx';
import { Button } from '../components/common/Button.jsx';
import { ConfirmDialog } from '../components/common/ConfirmDialog.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { EmptyState, QueryState } from '../components/common/States.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { Mono } from '../components/common/Links.jsx';
import { JobProgress } from '../components/jobs/JobProgress.jsx';
import { AdminKeyNotice } from '../components/jobs/AdminGate.jsx';
import { formatBytes, formatDateTime, formatNumber } from '../utils/format.js';

const LABEL = /^[a-z0-9][a-z0-9-]{0,39}$/;

function ExportFiles({ exp }) {
  const columns = [
    {
      key: 'file',
      header: 'File',
      render: (f) => (
        <span className="inline-flex items-center gap-2">
          {f.format === 'csv' ? <FileSpreadsheet className="size-3.5 text-good-ink" aria-hidden /> : <FileJson className="size-3.5 text-cobalt-700" aria-hidden />}
          <Mono>{f.file}</Mono>
        </span>
      ),
    },
    { key: 'format', header: 'Format', render: (f) => <Tag>{f.format.toUpperCase()}</Tag>, hideBelow: 'sm' },
    { key: 'rows', header: 'Records', align: 'right', render: (f) => (f.rows === null ? '—' : formatNumber(f.rows)) },
    { key: 'bytes', header: 'Size', align: 'right', render: (f) => formatBytes(f.bytes), hideBelow: 'sm' },
    { key: 'sha', header: 'SHA-256', render: (f) => (f.sha256 ? <span className="id-mono text-faint" title={f.sha256}>{f.sha256.slice(0, 16)}…</span> : '—'), hideBelow: 'lg' },
    {
      key: 'dl',
      header: <span className="sr-only">Download</span>,
      render: (f) => (
        <a
          href={exportApi.fileUrl(exp.label, f.file)}
          download={f.file}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-cobalt-700 hover:bg-cobalt-50"
          aria-label={`Download ${f.file}`}
        >
          <Download className="size-3.5" aria-hidden /> Download
        </a>
      ),
    },
  ];
  return <DataTable columns={columns} rows={exp.files} rowKey={(f) => f.file} dense caption={`Files of export ${exp.label}`} />;
}

function RecentExportJobs({ token }) {
  const { hasAdminKey } = useApp();
  const jobs = useApiQuery(`jobs-EXPORT-${token}`, (signal) => jobApi.list({ type: 'EXPORT', limit: 10 }, { signal }), { enabled: hasAdminKey });
  if (!hasAdminKey) return <p className="px-4 py-3 text-[12.5px] text-muted">Enter the admin key to list export jobs.</p>;
  return (
    <DataTable
      dense
      columns={[
        { key: 'jobId', header: 'Export job', render: (j) => <Mono>{j.jobId}</Mono> },
        { key: 'label', header: 'Label', render: (j) => j.params?.label ?? 'latest' },
        { key: 'status', header: 'Status', render: (j) => <StatusBadge tone={{ SUCCEEDED: 'good', FAILED: 'crit', RUNNING: 'info', QUEUED: 'neutral' }[j.status]} value={j.status} /> },
        { key: 'created', header: 'Created (UTC)', render: (j) => <span className="num">{formatDateTime(j.createdAt)}</span>, hideBelow: 'sm' },
        { key: 'files', header: 'Files', align: 'right', render: (j) => j.result?.files?.length ?? '—', hideBelow: 'md' },
        { key: 'error', header: 'Error', render: (j) => (j.error ? <span className="text-crit-ink">{j.error.message}</span> : '—'), hideBelow: 'lg' },
      ]}
      rows={jobs.data}
      rowKey={(j) => j.jobId}
      loading={jobs.loading}
      error={jobs.error}
      onRetry={jobs.refetch}
      emptyTitle="No export jobs yet"
    />
  );
}

export default function ExportsPage() {
  const { hasAdminKey } = useApp();
  const [label, setLabel] = useState('latest');
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [token, setToken] = useState(0);
  const exportsList = useApiQuery(`exports-${token}`, (signal) => exportApi.list({ signal }));
  const { job, error: pollError, done } = useJobPoller(jobId, {
    onFinish: (j) => {
      setToken((t) => t + 1);
      if (j.status === 'SUCCEEDED') toast.success(`Export "${j.result?.label}" completed`, { description: `${j.result?.files?.length} files written` });
      else toast.error('Export failed', { description: j.error?.message });
    },
  });
  const running = Boolean(jobId) && !done;
  const labelValid = LABEL.test(label);
  const exists = (exportsList.data ?? []).some((e) => e.label === label);

  const start = async () => {
    setStarting(true);
    try {
      const { data } = await exportApi.start({ label });
      setJobId(data.jobId);
      toast.info('Export job started');
    } catch (err) {
      toast.error(err.code === 'JOB_CONFLICT' ? 'Another data job is already running' : err.message);
    } finally {
      setStarting(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Exports"
        description="CSV datasets and JSON manifests streamed from MongoDB. Downloads are offered only for files that exist on the server and are listed in their export's manifest."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Create export" subtitle="Runs as a background job; files are written atomically">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (labelValid) setConfirm(true);
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="export-label" className="text-[12px] font-medium text-ink-2">
                Export label
              </label>
              <input
                id="export-label"
                className={`field ${labelValid ? '' : 'border-crit'}`}
                value={label}
                onChange={(e) => setLabel(e.target.value.toLowerCase())}
                aria-invalid={!labelValid || undefined}
                aria-describedby="export-label-hint"
                maxLength={40}
              />
              <span id="export-label-hint" className={`text-[11.5px] ${labelValid ? 'text-muted' : 'text-crit-ink'}`}>
                {labelValid ? `Written to exports/${label}/${exists ? ' (replaces the existing export)' : ''}` : 'Lowercase letters, digits and hyphens; must start with a letter or digit.'}
              </span>
            </div>
            <AdminKeyNotice />
            <Button type="submit" variant="primary" icon={Play} disabled={!hasAdminKey || !labelValid || running} loading={starting}>
              {running ? 'Export running…' : 'Start export'}
            </Button>
            <JobProgress job={job} pollError={pollError} />
          </form>
        </Panel>
        <Panel title="Export jobs" className="xl:col-span-2" bodyClassName="">
          <RecentExportJobs token={token} />
        </Panel>
      </div>

      <div className="mt-4 space-y-4">
        <QueryState
          query={exportsList}
          isEmpty={(l) => !l?.length}
          empty={
            <Panel>
              <EmptyState icon={FileSpreadsheet} title="No completed exports on the server" description="Create an export to produce CSV files, the dataset manifest and the validation report." />
            </Panel>
          }
        >
          {(list) =>
            list.map((exp) => (
              <Panel
                key={exp.label}
                title={
                  <span className="flex items-center gap-2">
                    exports/<span className="id-mono">{exp.label}</span>
                  </span>
                }
                subtitle={
                  exp.error
                    ? exp.error
                    : `Exported ${formatDateTime(exp.exportedAt, { year: true })} UTC · ${exp.profile} profile · seed ${exp.seed}${exp.validationRunId ? ` · validation ${exp.validationRunId}` : ''}`
                }
                actions={exp.datasetChecksum && <span className="id-mono hidden text-faint md:inline" title={exp.datasetChecksum}>dataset {exp.datasetChecksum.slice(0, 12)}…</span>}
                bodyClassName=""
              >
                {exp.files ? <ExportFiles exp={exp} /> : <p className="px-4 py-3 text-[12.5px] text-crit-ink">This export is incomplete or unreadable.</p>}
              </Panel>
            ))
          }
        </QueryState>
      </div>

      <ConfirmDialog open={confirm} title={`Export to exports/${label}?`} confirmLabel="Start export" onConfirm={start} onCancel={() => setConfirm(false)} busy={starting}>
        Streams all 12 collections to CSV plus anomaly, validation and dataset manifests (about 200 MB at full volume).
        {exists && ' The existing export with this label will be replaced.'}
      </ConfirmDialog>
    </>
  );
}
