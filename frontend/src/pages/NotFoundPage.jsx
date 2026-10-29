import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-md border border-line bg-surface text-muted">
        <Compass className="size-5" aria-hidden />
      </span>
      <h1 className="text-[18px] font-semibold text-ink">Page not found</h1>
      <p className="mt-1 text-[13px] text-muted">This address does not match any page in YottaFlex Intelligence.</p>
      <Link to="/" className="mt-4 inline-flex h-8 items-center rounded-md bg-cobalt-600 px-3 text-[13px] font-medium text-white hover:bg-cobalt-700">
        Back to overview
      </Link>
    </div>
  );
}
