import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Database, Play } from 'lucide-react';
import { analyticsApi, generatorApi, jobApi } from '../api/index.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useJobPoller } from '../hooks/useJobPoller.js';
import { useApp } from '../context/AppContext.jsx';
import { KeyValueList, PageHeader, Panel } from '../components/common/Panel.jsx';
import { Button } from '../components/common/Button.jsx';
import { ConfirmDialog } from '../components/common/ConfirmDialog.jsx';
import { DataTable } from '../components/common/DataTable.jsx';
import { StatusBadge, Tag } from '../components/common/StatusBadge.jsx';
import { Mono } from '../components/common/Links.jsx';
import { JobProgress } from '../components/jobs/JobProgress.jsx';
import { AdminKeyNotice } from '../components/jobs/AdminGate.jsx';
import { generatorSchema, PRESETS, toGenerateRequest } from '../components/generator/generatorSchema.js';
import { formatDateTime, formatNumber, humanize } from '../utils/format.js';

function Field({ label, name, register, error, hint, ...rest }) {
  const id = `gen-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        className={`field num ${error ? 'border-crit focus:border-crit focus:ring-crit-soft' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...register(name)}
        {...rest}
      />
      {error ? (
        <span id={`${id}-err`} role="alert" className="text-[11.5px] text-crit-ink">
          {error.message}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="text-[11.5px] text-muted">
            {hint}
          </span>
        )
      )}
    </div>
  );
}

function RecentJobs({ refreshToken }) {
  const { hasAdminKey } = useApp();
  const jobs = useApiQuery(`jobs-GENERATE-${refreshToken}`, (signal) => jobApi.list({ type: 'GENERATE', limit: 10 }, { signal }), { enabled: hasAdminKey });
  if (!hasAdminKey) return <p className="px-4 py-3 text-[12.5px] text-muted">Enter the admin key to list generation jobs.</p>;
  return (
    <DataTable
      dense
      columns={[
        { key: 'jobId', header: 'Job', render: (j) => <Mono>{j.jobId}</Mono> },
        { key: 'status', header: 'Status', render: (j) => <StatusBadge tone={{ SUCCEEDED: 'good', FAILED: 'crit', RUNNING: 'info', QUEUED: 'neutral' }[j.status]} value={j.status} /> },
        { key: 'profile', header: 'Config', render: (j) => `${j.params?.profile ?? '—'} · seed ${j.params?.seed ?? 'default'}${j.params?.overrides ? ' · custom' : ''}`, hideBelow: 'sm' },
        { key: 'started', header: 'Started (UTC)', render: (j) => <span className="num">{formatDateTime(j.startedAt)}</span>, hideBelow: 'md' },
        { key: 'finished', header: 'Finished', render: (j) => <span className="num">{formatDateTime(j.finishedAt)}</span>, hideBelow: 'md' },
        { key: 'error', header: 'Error', render: (j) => (j.error ? <span className="block max-w-64 truncate text-crit-ink" title={j.error.message}>{j.error.message}</span> : '—'), hideBelow: 'lg' },
      ]}
      rows={jobs.data}
      rowKey={(j) => j.jobId}
      loading={jobs.loading}
      error={jobs.error}
      onRetry={jobs.refetch}
      emptyTitle="No generation jobs yet"
    />
  );
}

export default function DatasetGeneratorPage() {
  const { hasAdminKey, config } = useApp();
  const [pending, setPending] = useState(null);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const summary = useApiQuery(`summary-gen-${refreshToken}`, (signal) => analyticsApi.summary({ partition: 'BASELINE' }, { signal }));
  const { job, error: pollError, done } = useJobPoller(jobId, {
    onFinish: (j) => {
      setRefreshToken((t) => t + 1);
      if (j.status === 'SUCCEEDED') toast.success('Dataset generated', { description: `Checksum ${j.result?.datasetChecksum?.slice(0, 16)}…` });
      else toast.error('Generation failed', { description: j.error?.message });
    },
  });
  const running = Boolean(jobId) && !done;

  const defaultSeed = config?.generator?.defaultSeed ?? 20261022;
  const { register, handleSubmit, setValue, watch, formState, reset } = useForm({
    resolver: zodResolver(generatorSchema),
    mode: 'onChange',
    defaultValues: { profile: 'small', seed: defaultSeed, batchSize: 1000, mode: 'reset', ...PRESETS.small },
  });
  useEffect(() => {
    if (config?.generator) reset((v) => ({ ...v, seed: config.generator.defaultSeed, batchSize: config.generator.defaultBatchSize }));
  }, [config, reset]);
  const values = watch();
  const errors = formState.errors;

  const applyPreset = (profile) => {
    setValue('profile', profile);
    for (const [k, v] of Object.entries(PRESETS[profile])) setValue(k, v, { shouldValidate: true });
  };

  const submit = handleSubmit((v) => setPending(toGenerateRequest(v)));
  const confirmStart = async () => {
    setStarting(true);
    try {
      const { data } = await generatorApi.start(pending);
      setJobId(data.jobId);
      toast.info('Generation job queued', { description: data.jobId });
      setPending(null);
    } catch (err) {
      toast.error(err.code === 'JOB_CONFLICT' ? 'Another data job is already running' : err.message, {
        description: err.details?.[0]?.jobId ? `Active job ${err.details[0].jobId}` : err.details?.map((d) => `${d.path}: ${d.message}`).join('; '),
      });
      setPending(null);
    } finally {
      setStarting(false);
    }
  };

  const dataset = summary.data?.dataset;
  const isFull = values.profile === 'full' && Object.entries(PRESETS.full).every(([k, v]) => Number(values[k]) === v);

  return (
    <>
      <PageHeader
        title="Dataset generator"
        description="Deterministic synthetic data generation. The same seed and configuration always reproduce the same dataset and checksum."
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Configuration" className="xl:col-span-2">
          <form onSubmit={submit} noValidate className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-[12px] font-medium text-ink-2">Preset</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
                {[
                  { key: 'tiny', label: 'Tiny', hint: '600 shipments · ~10 s' },
                  { key: 'small', label: 'Development', hint: '5,000 shipments · ~40 s' },
                  { key: 'full', label: 'Full challenge', hint: '50,000 shipments · ~4 min' },
                ].map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={values.profile === p.key}
                    onClick={() => applyPreset(p.key)}
                    className={`rounded-md border px-3 py-2.5 text-left transition-colors ${values.profile === p.key ? 'border-cobalt-600 bg-cobalt-50 ring-1 ring-cobalt-600' : 'border-line-strong hover:bg-subtle'}`}
                  >
                    <span className="block text-[13px] font-medium text-ink">{p.label}</span>
                    <span className="block text-[11.5px] text-muted">{p.hint}</span>
                  </button>
                ))}
              </div>
              {isFull && (
                <p className="mt-2 text-[12px] text-ink-2">
                  Challenge volumes: <strong>50,000</strong> shipments, <strong>300,000</strong> tracking events, <strong>100</strong> facilities, <strong>1,000</strong> disruption windows.
                </p>
              )}
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Seed" name="seed" register={register} error={errors.seed} inputMode="numeric" hint="Same seed + config = identical dataset" />
              <Field label="Shipments" name="shipments" register={register} error={errors.shipments} inputMode="numeric" />
              <Field label="Tracking events" name="trackingEvents" register={register} error={errors.trackingEvents} inputMode="numeric" hint="Exact baseline total (5.2–6.8 per shipment)" />
              <div className="flex flex-col gap-1">
                <label htmlFor="gen-facilities" className="text-[12px] font-medium text-ink-2">
                  Facilities
                </label>
                <input id="gen-facilities" className="field num" value={100} disabled readOnly aria-describedby="gen-facilities-hint" />
                <span id="gen-facilities-hint" className="text-[11.5px] text-muted">
                  Fixed network: 14 hubs, 16 sort centers, 70 stations
                </span>
              </div>
              <Field label="Disruption windows" name="weatherEvents" register={register} error={errors.weatherEvents} inputMode="numeric" />
              <Field label="Simulation window (days)" name="simulationDays" register={register} error={errors.simulationDays} inputMode="numeric" />
              <Field label="Anomaly cases per variant" name="anomalyCasesPerVariant" register={register} error={errors.anomalyCasesPerVariant} inputMode="numeric" hint="15 labelled variants (scenarios A–I)" />
              <Field label="Batch size" name="batchSize" register={register} error={errors.batchSize} inputMode="numeric" hint="Shipments per bulk-write batch" />
            </div>

            <fieldset>
              <legend className="mb-2 text-[12px] font-medium text-ink-2">Mode</legend>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                <label className="flex items-start gap-2 text-[12.5px]">
                  <input type="radio" value="reset" {...register('mode')} className="mt-0.5 accent-cobalt-600" />
                  <span>
                    <span className="font-medium text-ink">Replace current dataset</span>
                    <span className="block text-muted">Drops all dataset collections, then generates from scratch.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[12.5px]">
                  <input type="radio" value="resume" {...register('mode')} className="mt-0.5 accent-cobalt-600" />
                  <span>
                    <span className="font-medium text-ink">Resume interrupted run</span>
                    <span className="block text-muted">Continues the last failed run with exactly this configuration.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <AdminKeyNotice />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" icon={Play} disabled={!hasAdminKey || running || !formState.isValid} loading={starting}>
                {running ? 'Generation running…' : 'Start generation'}
              </Button>
              {!formState.isValid && <span className="text-[12px] text-crit-ink">Fix the highlighted fields first.</span>}
            </div>
          </form>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Current dataset" subtitle="Latest completed generation manifest">
            {dataset ? (
              <KeyValueList
                columns={1}
                items={[
                  { label: 'Manifest', value: <Mono>{dataset.manifestId}</Mono> },
                  { label: 'Profile / seed', value: `${dataset.profile} · ${dataset.seed}` },
                  { label: 'Generated (UTC)', value: <span className="num">{formatDateTime(dataset.generatedAt, { year: true })}</span> },
                  { label: 'Snapshot (asOf)', value: <span className="num">{formatDateTime(dataset.simulationWindow?.asOf, { year: true })}</span> },
                  { label: 'Checksum', value: <span className="id-mono break-all whitespace-normal">{dataset.datasetChecksum}</span> },
                ]}
              />
            ) : (
              <p className="text-[12.5px] text-muted">{summary.loading ? 'Loading…' : 'No completed dataset.'}</p>
            )}
            {dataset?.targetCounts && (
              <ul className="mt-4 space-y-1.5 text-[12.5px]">
                {Object.entries(dataset.targetCounts).map(([k, t]) => (
                  <li key={k} className="flex items-center justify-between">
                    <span className="text-ink-2">{humanize(k.replace(/([A-Z])/g, '_$1'))}</span>
                    <span className="flex items-center gap-2">
                      <span className="num">{formatNumber(t.actual)}</span>
                      <StatusBadge tone={t.ok ? 'good' : 'crit'} label={t.ok ? 'target met' : `target ${formatNumber(t.target)}`} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[12px]">
              <Link to="/exports" className="text-cobalt-700 hover:underline">
                Dataset manifest &amp; exports
              </Link>
            </p>
          </Panel>
          <Panel title="Job status" subtitle="Background job on the backend; this page can be left and revisited">
            {job ? (
              <>
                <JobProgress job={job} pollError={pollError} />
                {job.status === 'SUCCEEDED' && job.result?.recordCounts && (
                  <div className="mt-3">
                    <p className="eyebrow mb-1.5">Records generated</p>
                    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                      {Object.entries(job.result.recordCounts).map(([k, c]) => (
                        <li key={k} className="flex justify-between">
                          <span className="text-ink-2">{k}</span>
                          <span className="num text-ink">{formatNumber(c.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-[12.5px] text-muted">
                <Database className="size-3.5" aria-hidden /> No job started from this page.
              </p>
            )}
          </Panel>
        </div>
      </div>
      <Panel title="Recent generation jobs" className="mt-4" bodyClassName="">
        <RecentJobs refreshToken={refreshToken} />
      </Panel>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.resume ? 'Resume interrupted generation?' : 'Replace the current dataset?'}
        confirmLabel={pending?.resume ? 'Resume' : 'Replace and generate'}
        tone={pending?.resume ? 'primary' : 'danger'}
        onConfirm={confirmStart}
        onCancel={() => setPending(null)}
        busy={starting}
      >
        {pending && (
          <>
            {!pending.resume && <p>All dataset collections will be dropped and regenerated. Validation results will refer to the old dataset until validation runs again.</p>}
            <p className="mt-2">
              <Tag>{pending.profile}</Tag> seed <span className="num">{pending.seed}</span>
              {pending.overrides && <> · custom: {Object.entries(pending.overrides).map(([k, v]) => `${k}=${v}`).join(', ')}</>}
            </p>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
