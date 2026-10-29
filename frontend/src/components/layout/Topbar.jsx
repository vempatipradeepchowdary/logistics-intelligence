import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Menu, Search } from 'lucide-react';
import { SECTION_LABELS } from './navigation.js';
import { useApp } from '../../context/AppContext.jsx';
import { formatDateTime } from '../../utils/format.js';

const SHIPMENT_ID = /^SHP-\d{4}-\d{6}$/i;

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [{ to: '/', label: 'YottaFlex' }];
  if (parts.length) crumbs.push({ to: `/${parts[0]}`, label: SECTION_LABELS[parts[0]] ?? parts[0] });
  else crumbs.push({ to: '/', label: 'Overview' });
  if (parts[1]) crumbs.push({ to: pathname, label: decodeURIComponent(parts[1]) });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[12.5px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.to}-${i}`} className={`flex min-w-0 items-center gap-1 ${i === 0 ? 'hidden sm:flex' : ''}`}>
              {i > 0 && <ChevronRight className={`size-3.5 shrink-0 text-faint ${i === 1 ? 'hidden sm:block' : ''}`} aria-hidden />}
              {last ? (
                <span aria-current="page" className={`truncate font-medium text-ink ${parts[1] && last ? 'id-mono' : ''}`}>
                  {c.label}
                </span>
              ) : (
                <Link to={c.to} className="truncate text-muted hover:text-ink">
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Jump to a shipment by exact ID, or search shipments by ID prefix. */
function GlobalSearch() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const submit = (e) => {
    e.preventDefault();
    const q = value.trim().toUpperCase();
    if (!q) return;
    if (SHIPMENT_ID.test(q)) navigate(`/shipments/${q}`);
    else navigate(`/shipments?q=${encodeURIComponent(q)}`);
    setValue('');
  };
  return (
    <form onSubmit={submit} role="search" className="relative hidden md:block">
      <label htmlFor="global-search" className="sr-only">
        Search shipments by ID
      </label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
      <input
        id="global-search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Shipment ID, e.g. SHP-2026-000123"
        maxLength={20}
        pattern="[A-Za-z0-9\-]{1,20}"
        className="field h-8 w-72 pl-8"
      />
    </form>
  );
}

/** Reflects the real /api/health result; never assumed. */
export function ConnectionStatus() {
  const { health, checkHealth } = useApp();
  const styles = {
    online: { dot: 'bg-good', text: 'API online' },
    degraded: { dot: 'bg-warn', text: 'API degraded' },
    offline: { dot: 'bg-crit', text: 'API offline' },
    checking: { dot: 'bg-faint animate-pulse', text: 'Checking API' },
  }[health.status];
  const title = health.checkedAt
    ? `Last checked ${formatDateTime(health.checkedAt, { seconds: true })} UTC${health.data ? ` · DB ${health.data.database.state}, ping ${health.data.database.pingMs ?? '—'} ms` : ''}`
    : 'Checking backend health';
  return (
    <button
      type="button"
      onClick={() => checkHealth()}
      title={`${title} (click to re-check)`}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:bg-subtle"
      aria-live="polite"
    >
      <span className={`size-2 rounded-full ${styles.dot}`} aria-hidden />
      <span className="sr-only sm:not-sr-only">{styles.text}</span>
    </button>
  );
}

export function Topbar({ onOpenMobileNav }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/85 lg:px-6">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="inline-flex size-8 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-subtle lg:hidden"
        aria-label="Open navigation"
        aria-controls="mobile-nav"
      >
        <Menu className="size-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      <GlobalSearch />
      <ConnectionStatus />
    </header>
  );
}
