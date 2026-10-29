import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { LoadingBlock } from '../common/States.jsx';
import { useApp } from '../../context/AppContext.jsx';

const COLLAPSE_KEY = 'yf.sidebarCollapsed';

function OfflineBanner() {
  const { health } = useApp();
  if (health.status !== 'offline') return null;
  return (
    <div role="alert" className="border-b border-crit/25 bg-crit-soft px-4 py-2 text-[12.5px] text-crit-ink lg:px-6">
      The backend API is unreachable ({health.error?.message}). Data on this page cannot be loaded until it is back.
    </div>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* preference only */
    }
  }, [collapsed]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
        <OfflineBanner />
        <main id="main" className="flex-1 overflow-y-auto" tabIndex={-1}>
          <div className="mx-auto w-full max-w-[1480px] px-4 py-5 lg:px-6 lg:py-6">
            <Suspense fallback={<LoadingBlock rows={8} label="Loading page" />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
