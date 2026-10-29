import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const ADMIN_KEY_STORAGE = 'yf.adminKey';
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_GET_RETRIES = 2;

/**
 * Admin key for /api/admin/* (development-grade shared key). Kept in sessionStorage only for
 * this browser tab session; it is never bundled into the build.
 */
export const adminKeyStore = {
  get() {
    try {
      return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem(ADMIN_KEY_STORAGE, value);
      else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    } catch {
      /* storage unavailable: key lives only in memory of the caller */
    }
  },
};

/** Normalised error shape used by every screen. */
export class ApiError extends Error {
  constructor({ message, status = null, code = 'UNKNOWN', details = [], canceled = false, network = false }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.canceled = canceled;
    this.network = network;
  }
}

export function normalizeError(err) {
  if (err instanceof ApiError) return err;
  if (axios.isCancel(err) || err?.name === 'CanceledError') {
    return new ApiError({ message: 'Request canceled', code: 'CANCELED', canceled: true });
  }
  const res = err?.response;
  if (res) {
    const body = res.data?.error;
    return new ApiError({
      message: body?.message ?? `Request failed with status ${res.status}`,
      status: res.status,
      code: body?.code ?? `HTTP_${res.status}`,
      details: body?.details ?? [],
    });
  }
  if (err?.code === 'ECONNABORTED') {
    return new ApiError({ message: 'The server took too long to respond', code: 'TIMEOUT', network: true });
  }
  return new ApiError({
    message: 'Cannot reach the backend API. Is the server running?',
    code: 'NETWORK_ERROR',
    network: true,
  });
}

export const http = axios.create({ baseURL: API_BASE_URL, timeout: 45000 });

http.interceptors.request.use((config) => {
  if (config.url?.startsWith('/admin')) {
    const key = adminKeyStore.get();
    if (key) config.headers['x-api-key'] = key;
  }
  return config;
});

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiError({ message: 'Request canceled', code: 'CANCELED', canceled: true }));
    });
  });

/** Drop empty filter values so URLs stay clean and the backend's strict schemas are satisfied. */
export function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

/**
 * Safe (idempotent) GET with bounded retries on network errors and 502-504.
 * Resolves to the backend envelope `{ data, meta }`.
 */
export async function apiGet(url, { params, signal } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await http.get(url, { params: cleanParams(params), signal });
      return { data: res.data?.data, meta: res.data?.meta ?? {} };
    } catch (raw) {
      const err = normalizeError(raw);
      const retryable = err.network || RETRYABLE_STATUS.has(err.status);
      if (err.canceled || !retryable || attempt >= MAX_GET_RETRIES) throw err;
      await sleep(400 * 2 ** attempt, signal);
    }
  }
}

/** Non-idempotent request: never retried automatically. */
export async function apiPost(url, body = {}) {
  try {
    const res = await http.post(url, body);
    return { data: res.data?.data, meta: res.data?.meta ?? {} };
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Absolute URL for links the browser follows directly (file downloads). */
export const apiUrl = (path) => `${API_BASE_URL}${path}`;
