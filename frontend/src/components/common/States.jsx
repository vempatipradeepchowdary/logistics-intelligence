import { CloudOff, Inbox, KeyRound, RefreshCw, ServerCrash } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './Button.jsx';

export function Skeleton({ className = 'h-4 w-full' }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}

export function LoadingBlock({ rows = 4, label = 'Loading' }) {
  return (
    <div className="space-y-2.5" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ title = 'No results', description, action, icon: Icon = Inbox, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'}`}>
      <span className="mb-3 inline-flex size-9 items-center justify-center rounded-md border border-line bg-subtle text-muted">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-[12.5px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Error display for a failed request. Never substitutes sample data. */
export function ErrorState({ error, onRetry, compact = false }) {
  const network = error?.network;
  const unauthorized = error?.status === 401;
  const Icon = unauthorized ? KeyRound : network ? CloudOff : ServerCrash;
  const title = unauthorized
    ? 'Admin key required'
    : network
      ? 'Backend unreachable'
      : error?.status === 404
        ? 'Not found'
        : 'Request failed';
  return (
    <div role="alert" className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'}`}>
      <span className="mb-3 inline-flex size-9 items-center justify-center rounded-md border border-crit/25 bg-crit-soft text-crit-ink">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-md text-[12.5px] text-muted">
        {error?.message ?? 'Unknown error'}
        {error?.code && !network && <span className="id-mono ml-1 text-faint">({error.code})</span>}
      </p>
      <div className="mt-4 flex gap-2">
        {unauthorized && (
          <Link to="/settings" className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-subtle">
            Enter admin key
          </Link>
        )}
        {onRetry && (
          <Button icon={RefreshCw} onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

/** Standard wrapper: loading skeleton -> error -> empty -> children. */
export function QueryState({ query, rows = 4, empty, isEmpty, children }) {
  if (query.loading && query.data === undefined) return <LoadingBlock rows={rows} />;
  if (query.error && query.data === undefined) return <ErrorState error={query.error} onRetry={query.refetch} compact />;
  const emptyNow = isEmpty ? isEmpty(query.data) : Array.isArray(query.data) && query.data.length === 0;
  if (emptyNow) return empty ?? <EmptyState compact />;
  return children(query.data, query.meta);
}

export function InlineRetry({ onRetry }) {
  return (
    <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-[12px] font-medium text-cobalt-700 hover:underline">
      <RefreshCw className="size-3" aria-hidden /> Retry
    </button>
  );
}
