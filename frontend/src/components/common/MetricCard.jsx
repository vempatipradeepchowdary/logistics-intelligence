import { InfoTip } from './InfoTip.jsx';
import { Skeleton } from './States.jsx';

/**
 * KPI tile. `context` is a factual secondary line (e.g. "of 48,613 delivered"); no trend arrows
 * are shown because the dataset is a single snapshot without a comparison period.
 */
export function MetricCard({ label, value, icon: Icon, info, context, tone = 'neutral', loading = false, error = false }) {
  const accent =
    tone === 'good' ? 'text-good-ink' : tone === 'warn' ? 'text-warn-ink' : tone === 'crit' ? 'text-crit-ink' : 'text-ink';
  return (
    <div className="card animate-in flex min-w-0 flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-muted">
          <span className="truncate" title={typeof label === 'string' ? label : undefined}>
            {label}
          </span>
          {info && <InfoTip text={info} />}
        </span>
        {Icon && (
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-subtle text-navy-600">
            <Icon className="size-3.5" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <span className={`num text-[24px] font-semibold leading-7 tracking-[-0.02em] ${accent}`}>
          {error ? '—' : value}
        </span>
      )}
      <span className="min-h-4 truncate text-[11.5px] text-muted">{loading ? '' : error ? 'Unavailable' : context}</span>
    </div>
  );
}
