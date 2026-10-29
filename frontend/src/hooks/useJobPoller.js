import { useCallback, useEffect, useRef, useState } from 'react';
import { jobApi } from '../api/index.js';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED']);

/**
 * Polls GET /api/admin/jobs/:jobId until the job is terminal. Progress values come from the
 * backend job record (written by the worker); nothing is simulated client-side.
 */
export function useJobPoller(jobId, { intervalMs = 1500, onFinish } = {}) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    if (!jobId) return undefined;
    let stopped = false;
    let timer;
    const controller = new AbortController();
    const tick = async () => {
      try {
        const { data } = await jobApi.get(jobId, { signal: controller.signal });
        if (stopped) return;
        setJob(data);
        setError(null);
        if (TERMINAL.has(data.status)) {
          onFinishRef.current?.(data);
          return;
        }
      } catch (err) {
        if (stopped || err.canceled) return;
        setError(err);
      }
      timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [jobId, intervalMs]);

  const reset = useCallback(() => {
    setJob(null);
    setError(null);
  }, []);
  return { job, error, done: job ? TERMINAL.has(job.status) : false, reset };
}
