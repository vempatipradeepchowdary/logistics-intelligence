import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useApp } from '../../context/AppContext.jsx';

/** Explains why an admin action is disabled (no key) instead of showing a dead button. */
export function AdminKeyNotice() {
  const { hasAdminKey } = useApp();
  if (hasAdminKey) return null;
  return (
    <div className="flex gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
      <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
      <p>
        Admin operations need the backend&apos;s <span className="id-mono">ADMIN_API_KEY</span>.{' '}
        <Link to="/settings" className="font-medium whitespace-nowrap text-cobalt-700 hover:underline">
          Enter it in Settings
        </Link>
      </p>
    </div>
  );
}
