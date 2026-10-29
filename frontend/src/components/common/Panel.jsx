import { InfoTip } from './InfoTip.jsx';

export function PageHeader({ title, description, actions, meta }) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, subtitle, info, actions, children, className = '', bodyClassName = 'p-4', id }) {
  return (
    <section className={`card animate-in min-w-0 ${className}`} aria-labelledby={title && id ? id : undefined}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id={id} className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
              {title}
              {info && <InfoTip text={info} />}
            </h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function KeyValueList({ items, columns = 2 }) {
  const grid = columns === 3 ? 'sm:grid-cols-3' : columns === 1 ? '' : 'sm:grid-cols-2';
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${grid}`}>
      {items.filter(Boolean).map(({ label, value, hint }) => (
        <div key={label} className="min-w-0">
          <dt className="flex items-center gap-1 text-[11.5px] font-medium text-muted">
            {label}
            {hint && <InfoTip text={hint} />}
          </dt>
          <dd className="mt-0.5 truncate text-[13px] text-ink">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ value, label, tone = 'cobalt' }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const color = tone === 'crit' ? 'bg-crit' : tone === 'good' ? 'bg-good' : 'bg-cobalt-600';
  return (
    <div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label}
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
