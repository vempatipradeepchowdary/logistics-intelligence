import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useApiQuery } from './useApiQuery.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

describe('useApiQuery', () => {
  it('never lets a stale response overwrite a newer one', async () => {
    const slow = deferred();
    const fast = deferred();
    const { result, rerender } = renderHook(({ k, p }) => useApiQuery(k, () => p.promise), {
      initialProps: { k: 'page-1', p: slow },
    });
    rerender({ k: 'page-2', p: fast });
    await act(async () => fast.resolve({ data: 'page-2-data', meta: {} }));
    await act(async () => slow.resolve({ data: 'page-1-data', meta: {} }));
    expect(result.current.data).toBe('page-2-data');
  });

  it('aborts the previous request when the key changes', async () => {
    const signals = [];
    const { rerender } = renderHook(({ k }) => useApiQuery(k, (signal) => (signals.push(signal), new Promise(() => {}))), {
      initialProps: { k: 'a' },
    });
    rerender({ k: 'b' });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('exposes errors and supports refetch', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useApiQuery('x', () => (++calls === 1 ? Promise.reject(Object.assign(new Error('boom'), { status: 500 })) : Promise.resolve({ data: 42, meta: {} }))),
    );
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current.error).toBeNull();
  });
});
