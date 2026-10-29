import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from './States.jsx';
import { formatNumber } from '../../utils/format.js';

/**
 * Compact data table.
 * columns: [{ key, header, render?(row), align?, sortKey?, className?, hideBelow? ('sm'|'md'|'lg') }]
 * sort: backend sort string ("field" asc / "-field" desc); onSortChange(nextSort)
 */
export function DataTable({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  sort,
  onSortChange,
  emptyTitle = 'No matching records',
  emptyDescription,
  caption,
  skeletonRows = 8,
  dense = false,
}) {
  const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };
  const initialLoad = loading && !rows?.length;
  const sortState = (col) => {
    if (!col.sortKey || !sort) return null;
    if (sort === col.sortKey) return 'asc';
    if (sort === `-${col.sortKey}`) return 'desc';
    return null;
  };
  const toggleSort = (col) => {
    const state = sortState(col);
    onSortChange?.(state === 'desc' ? col.sortKey : `-${col.sortKey}`);
  };

  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <table className={`table-base ${dense ? '[&_td]:py-1.5' : ''}`}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((col) => {
                const state = sortState(col);
                const SortIcon = state === 'asc' ? ArrowUp : state === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`${col.align === 'right' ? 'text-right' : ''} ${col.hideBelow ? hide[col.hideBelow] : ''}`}
                    aria-sort={state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : undefined}
                  >
                    {col.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={`inline-flex items-center gap-1 uppercase hover:text-ink ${state ? 'text-ink' : ''}`}
                      >
                        {col.header}
                        <SortIcon className="size-3" aria-hidden />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={loading && rows?.length ? 'opacity-60 transition-opacity' : ''}>
            {initialLoad
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={`sk-${i}`}>
                    {columns.map((col) => (
                      <td key={col.key} className={col.hideBelow ? hide[col.hideBelow] : ''}>
                        <Skeleton className="h-3.5 w-full max-w-36" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows?.map((row, i) => (
                  <tr key={rowKey ? rowKey(row, i) : i}>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${col.align === 'right' ? 'num text-right' : ''} ${col.className ?? ''} ${col.hideBelow ? hide[col.hideBelow] : ''}`}
                      >
                        {col.render ? col.render(row) : (row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && !error && rows && rows.length === 0 && (
        <EmptyState title={emptyTitle} description={emptyDescription} compact />
      )}
      {loading && <span className="sr-only" role="status">Loading rows…</span>}
    </div>
  );
}

export function Pagination({ page, totalPages, total, limit, onPageChange, onLimitChange, pageSizes = [25, 50, 100] }) {
  const last = Math.max(1, totalPages ?? 1);
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total ?? 0, page * limit);
  const btn =
    'inline-flex size-7 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-2 hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <nav className="flex flex-col gap-2 border-t border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between" aria-label="Pagination">
      <p className="num text-[12px] text-muted">
        {total === undefined ? '—' : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}`}
      </p>
      <div className="flex items-center gap-3">
        {onLimitChange && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            Rows
            <select className="field h-7 w-auto py-0 pr-7" value={limit} onChange={(e) => onLimitChange(Number(e.target.value))}>
              {pageSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-1">
          <button type="button" className={btn} onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="First page">
            <ChevronsLeft className="size-3.5" aria-hidden />
          </button>
          <button type="button" className={btn} onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <span className="num px-2 text-[12px] text-ink-2" aria-current="page">
            Page {formatNumber(page)} / {formatNumber(last)}
          </span>
          <button type="button" className={btn} onClick={() => onPageChange(page + 1)} disabled={page >= last} aria-label="Next page">
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
          <button type="button" className={btn} onClick={() => onPageChange(last)} disabled={page >= last} aria-label="Last page">
            <ChevronsRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}
