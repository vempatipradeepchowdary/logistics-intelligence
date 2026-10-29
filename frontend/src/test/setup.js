import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Pages are lazy-loaded chunks; the first import of a chart-heavy page takes >1s under jsdom.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

// Recharts' ResponsiveContainer needs ResizeObserver; jsdom does not provide one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;
window.scrollTo = vi.fn();
