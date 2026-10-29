import { useEffect, useId, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { humanize } from '../../utils/format.js';

export function FilterBar({ children, onReset, activeCount = 0 }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="border-b border-line px-3 py-3" role="search">
      {/* Small screens: filters collapse behind a toggle to keep the table in view. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[12.5px] font-medium text-ink-2 md:hidden"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters{activeCount ? ` (${activeCount})` : ''}
      </button>
      <div id={panelId} className={`${open ? 'mt-3 flex' : 'hidden'} flex-wrap items-end gap-2.5 md:mt-0 md:flex`}>
        <FilterBarBody onReset={onReset} activeCount={activeCount}>
          {children}
        </FilterBarBody>
      </div>
    </div>
  );
}

function FilterBarBody({ children, onReset, activeCount }) {
  return (
    <>
      {children}
      {onReset && activeCount > 0 && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-subtle hover:text-ink"
        >
          <X className="size-3.5" aria-hidden /> Clear filters ({activeCount})
        </button>
      )}
    </>
  );
}

function Labelled({ label, children, className = '' }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[11px] font-medium text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** Debounced text search; commits upstream after typing pauses. */
export function SearchInput({ label = 'Search', value, onChange, placeholder, pattern, className = 'w-56', delay = 350 }) {
  const [draft, setDraft] = useState(value ?? '');
  const debounced = useDebouncedValue(draft, delay);
  useEffect(() => setDraft(value ?? ''), [value]);
  useEffect(() => {
    if ((debounced ?? '') !== (value ?? '')) onChange(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const invalid = pattern && draft && !pattern.test(draft);
  return (
    <Labelled label={label} className={className}>
      {(id) => (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            id={id}
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-invalid={invalid || undefined}
            className={`field pl-8 ${invalid ? 'border-crit focus:border-crit focus:ring-crit-soft' : ''}`}
          />
        </div>
      )}
    </Labelled>
  );
}

export function SelectFilter({ label, value, onChange, options, allLabel = 'All', className = 'w-44', format = humanize }) {
  return (
    <Labelled label={label} className={className}>
      {(id) => (
        <select id={id} className="field pr-7" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {allLabel !== null && <option value="">{allLabel}</option>}
          {options.map((o) => {
            const opt = typeof o === 'object' ? o : { value: o, label: format(o) };
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
      )}
    </Labelled>
  );
}

/** UTC calendar-day range (YYYY-MM-DD). */
export function DateRangeFilter({ label = 'Date range (UTC)', from, to, onChange, min, max }) {
  const fromId = useId();
  const invalid = from && to && from > to;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-[11px] font-medium text-muted">{label}</legend>
      <div className="flex items-center gap-1.5">
        <label htmlFor={fromId} className="sr-only">
          From
        </label>
        <input
          id={fromId}
          type="date"
          className="field w-36"
          value={from ?? ''}
          min={min}
          max={max}
          onChange={(e) => onChange({ from: e.target.value, to })}
        />
        <span className="text-faint" aria-hidden>
          –
        </span>
        <input
          type="date"
          aria-label="To"
          className={`field w-36 ${invalid ? 'border-crit' : ''}`}
          value={to ?? ''}
          min={min}
          max={max}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange({ from, to: e.target.value })}
        />
      </div>
      {invalid && <span className="text-[11px] text-crit-ink">Start date is after end date</span>}
    </fieldset>
  );
}

export function ToggleFilter({ label, checked, onChange, description }) {
  const id = useId();
  return (
    <div className="flex h-8 items-center gap-2 self-end">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 rounded-sm border-line-strong accent-cobalt-600"
      />
      <label htmlFor={id} className="text-[12.5px] text-ink-2" title={description}>
        {label}
      </label>
    </div>
  );
}
