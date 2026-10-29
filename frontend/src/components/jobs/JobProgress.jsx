import { CheckCircle2, Loader2, OctagonAlert } from 'lucide-react';
import { ProgressBar } from '../common/Panel.jsx';
import { formatDateTime, formatNumber, humanize } from '../../utils/format.js';

/** Live view of a persisted backend job (status, phase, progress written by the worker). */
export function JobProgress({ job, pollError }) {
  if (!job) return null;
  const running = job.status === 'QUEUED' || job.status === 'RUNNING';
  const failed = job.status === 'FAILED';
  const percent = job.status === 'SUCCEEDED' ? 100 : job.progress?.percent ?? 0;
  const Icon = failed ? OctagonAlert : running ? Loader2 : CheckCircle2;
  const tone = failed ? 'text-crit-ink' : running ? 'text-cobalt-700' : 'text-good-ink';
  return (
    <div className="rounded-md border border-line bg-subtle p-3" aria-live="polite">
      <div className="flex items-center gap-2 text-[13px]">
        <Icon className={`size-4 ${tone} ${running ? 'animate-spin' : ''}`} aria-hidden />
        <span className={`font-medium ${tone}`}>{humanize(job.status)}</span>
        <span className="id-mono text-faint">{job.jobId}</span>
      </div>
      <div className="mt-2.5">
        <ProgressBar value={percent} label={`${humanize(job.type)} job progress`} tone={failed ? 'crit' : job.status === 'SUCCEEDED' ? 'good' : 'cobalt'} />
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">Phase</dt>
          <dd className="text-ink">{job.progress?.phase ? humanize(job.progress.phase) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Progress</dt>
          <dd className="num text-ink">
            {job.progress?.total ? `${formatNumber(job.progress.processed)} / ${formatNumber(job.progress.total)}` : job.progress?.processed ? formatNumber(job.progress.processed) : '—'}
            {percent ? ` (${percent}%)` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Started (UTC)</dt>
          <dd className="num text-ink">{formatDateTime(job.startedAt, { seconds: true })}</dd>
        </div>
        <div>
          <dt className="text-muted">Finished (UTC)</dt>
          <dd className="num text-ink">{formatDateTime(job.finishedAt, { seconds: true })}</dd>
        </div>
      </dl>
      {job.progress?.message && running && <p className="mt-2 text-[12px] text-muted">{job.progress.message}</p>}
      {failed && (
        <p className="mt-2 rounded-sm bg-crit-soft px-2 py-1.5 text-[12px] text-crit-ink" role="alert">
          {job.error?.code}: {job.error?.message}
        </p>
      )}
      {pollError && <p className="mt-2 text-[12px] text-warn-ink">Status polling interrupted: {pollError.message}</p>}
    </div>
  );
}
