import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filter/pagination state stored in the URL query string, so a view can be bookmarked or shared.
 * `defaults` defines the known keys; unknown query keys are ignored. Changing any filter other
 * than `page` resets `page` to 1.
 */
export function useUrlState(defaults) {
  const [params, setParams] = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);

  const state = useMemo(() => {
    const base = JSON.parse(defaultsKey);
    const out = {};
    for (const [key, fallback] of Object.entries(base)) {
      const raw = params.get(key);
      if (raw === null) out[key] = fallback;
      else if (typeof fallback === 'number') out[key] = Number.isFinite(Number(raw)) ? Number(raw) : fallback;
      else out[key] = raw;
    }
    return out;
  }, [params, defaultsKey]);

  const update = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const base = JSON.parse(defaultsKey);
          const next = new URLSearchParams(prev);
          const resetPage = Object.keys(patch).some((k) => k !== 'page') && 'page' in base;
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === null || value === '' || value === base[key]) next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultsKey],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);
  return [state, update, reset];
}
