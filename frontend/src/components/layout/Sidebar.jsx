import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { NAV_SECTIONS } from './navigation.js';
import { useApp } from '../../context/AppContext.jsx';

function Brand({ collapsed }) {
  return (
    <div className="flex h-14 items-center gap-2.5 px-4">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#17243a" />
        <path d="M8 9l6 7v7h4v-7l6-7h-4.6L16 13.2 12.6 9z" fill="#4a70f6" />
        <circle cx="24" cy="23" r="2.5" fill="#00977F" />
      </svg>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13.5px] font-semibold text-white">YottaFlex</p>
          <p className="truncate text-[11px] text-navy-300">Intelligence</p>
        </div>
      )}
    </div>
  );
}

function NavItems({ collapsed, onNavigate }) {
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 pb-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="mt-4 first:mt-2">
          {!collapsed && (
            <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-navy-300/70">{section.label}</p>
          )}
          <ul className="space-y-0.5">
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors ${
                      isActive ? 'bg-navy-700 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                    } ${collapsed ? 'justify-center px-0' : ''}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-cobalt-500" aria-hidden />}
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SessionFooter({ collapsed }) {
  const { hasAdminKey } = useApp();
  if (collapsed) return null;
  // No authentication exists in the backend; only the admin-key state for this tab is shown.
  return (
    <div className="border-t border-navy-800 px-4 py-3 text-[11.5px] text-navy-300">
      <p className="font-medium text-navy-200">Admin access</p>
      <p className="mt-0.5">{hasAdminKey ? 'API key set for this session' : 'Read-only (no admin key)'}</p>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  return (
    <>
      <aside
        className={`hidden shrink-0 flex-col bg-navy-900 transition-[width] duration-200 lg:flex ${collapsed ? 'w-[60px]' : 'w-[232px]'}`}
        aria-label="Sidebar"
      >
        <Brand collapsed={collapsed} />
        <NavItems collapsed={collapsed} />
        <SessionFooter collapsed={collapsed} />
        <button
          type="button"
          onClick={onToggle}
          className="flex h-10 items-center justify-center gap-2 border-t border-navy-800 text-[12px] text-navy-300 hover:bg-navy-800 hover:text-white"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
          {!collapsed && 'Collapse'}
        </button>
      </aside>

      {/* Mobile / tablet drawer */}
      <div className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div
          className={`absolute inset-0 bg-navy-950/50 transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={onMobileClose}
        />
        <aside
          id="mobile-nav"
          className={`absolute inset-y-0 left-0 flex w-[260px] flex-col bg-navy-900 shadow-[var(--shadow-pop)] transition-transform duration-200 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          aria-label="Mobile navigation"
          inert={mobileOpen ? undefined : ''}
        >
          <div className="flex items-center justify-between pr-2">
            <Brand />
            <button
              type="button"
              onClick={onMobileClose}
              className="inline-flex size-8 items-center justify-center rounded-md text-navy-200 hover:bg-navy-800"
              aria-label="Close navigation"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <NavItems onNavigate={onMobileClose} />
          <SessionFooter />
        </aside>
      </div>
    </>
  );
}
