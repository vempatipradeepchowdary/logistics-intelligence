import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch hook with request cancellation and stale-response protection.
 *  - `fetcher(signal)` must return `{ data, meta }`.
 *  - Re-runs whenever `key` (a stable string of the inputs) changes; the previous request is
 *    aborted, so an older response can never overwrite a newer one.
 *  - `keepPreviousData` keeps the last result visible while a new page/filter loads.
 */
export function useApiQuery(key, fetcher, { enabled = true, keepPreviousData = false } = {}) {
  const [state, setState] = useState({ data: undefined, meta: {}, error: null, loading: enabled });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    setState((s) => ({
      data: keepPreviousData ? s.data : undefined,
      meta: keepPreviousData ? s.meta : {},
      error: null,
      loading: true,
    }));
    fetcherRef
      .current(controller.signal)
      .then((res) => {
        if (id !== requestId.current) return;
        setState({ data: res.data, meta: res.meta ?? {}, error: null, loading: false });
      })
      .catch((err) => {
        if (id !== requestId.current || err?.canceled) return;
        setState((s) => ({ ...s, error: err, loading: false }));
      });
    return () => controller.abort();
  }, [key, enabled, keepPreviousData, reloadToken]);

  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);
  return { ...state, refetch };
}
