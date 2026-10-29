import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { OctagonAlert } from 'lucide-react';

/** Rendered when a page throws while rendering (or a lazy chunk fails to load). */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : (error?.message ?? 'Unknown error');
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="card max-w-md p-6 text-center" role="alert">
        <span className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-md bg-crit-soft text-crit-ink">
          <OctagonAlert className="size-5" aria-hidden />
        </span>
        <h1 className="text-[16px] font-semibold text-ink">Something went wrong</h1>
        <p className="mt-1 text-[13px] text-muted">{message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="h-8 rounded-md border border-line-strong px-3 text-[13px] font-medium hover:bg-subtle">
            Reload
          </button>
          <Link to="/" className="inline-flex h-8 items-center rounded-md bg-cobalt-600 px-3 text-[13px] font-medium text-white hover:bg-cobalt-700">
            Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
