import { apiGet, apiPost, apiUrl } from './apiClient.js';

// One module per backend area; each function maps 1:1 onto a documented Express route.

export const healthApi = {
  get: (opts) => apiGet('/health', opts),
  systemConfig: (opts) => apiGet('/system/config', opts),
};

export const shipmentApi = {
  list: (params, opts) => apiGet('/shipments', { params, ...opts }),
  get: (id, opts) => apiGet(`/shipments/${encodeURIComponent(id)}`, opts),
  events: (id, params, opts) => apiGet(`/shipments/${encodeURIComponent(id)}/events`, { params, ...opts }),
  etas: (id, opts) => apiGet(`/shipments/${encodeURIComponent(id)}/eta`, opts),
  timeline: (id, opts) => apiGet(`/shipments/${encodeURIComponent(id)}/timeline`, opts),
};

export const trackingApi = {
  list: (params, opts) => apiGet('/events', { params, ...opts }),
};

export const etaApi = {
  list: (params, opts) => apiGet('/etas', { params, ...opts }),
  get: (id, opts) => apiGet(`/etas/${encodeURIComponent(id)}`, opts),
  accuracy: (params, opts) => apiGet('/analytics/eta-accuracy', { params, ...opts }),
  breakdowns: (params, opts) => apiGet('/analytics/eta-accuracy/breakdowns', { params, ...opts }),
};

export const analyticsApi = {
  summary: (params, opts) => apiGet('/analytics/summary', { params, ...opts }),
  delays: (params, opts) => apiGet('/analytics/delays', { params, ...opts }),
  delayBreakdowns: (params, opts) => apiGet('/analytics/delays/breakdowns', { params, ...opts }),
  classifiedShipments: (params, opts) => apiGet('/analytics/delays/shipments', { params, ...opts }),
  eventVolume: (params, opts) => apiGet('/analytics/event-volume', { params, ...opts }),
};

export const facilityApi = {
  list: (params, opts) => apiGet('/facilities', { params, ...opts }),
  get: (id, params, opts) => apiGet(`/facilities/${encodeURIComponent(id)}`, { params, ...opts }),
};

export const disruptionApi = {
  list: (params, opts) => apiGet('/disruptions', { params, ...opts }),
  timeline: (opts) => apiGet('/disruptions/timeline', opts),
  get: (id, opts) => apiGet(`/disruptions/${encodeURIComponent(id)}`, opts),
};

export const qualityApi = {
  latest: (params, opts) => apiGet('/analytics/data-quality', { params, ...opts }),
  violations: (params, opts) => apiGet('/analytics/data-quality/violations', { params, ...opts }),
  runValidation: (body) => apiPost('/admin/validate', body),
};

export const jobApi = {
  list: (params, opts) => apiGet('/admin/jobs', { params, ...opts }),
  get: (jobId, opts) => apiGet(`/admin/jobs/${encodeURIComponent(jobId)}`, opts),
};

export const generatorApi = {
  start: (body) => apiPost('/admin/generate', body),
};

export const exportApi = {
  list: (opts) => apiGet('/exports', opts),
  start: (body) => apiPost('/admin/export', body),
  fileUrl: (label, file) => apiUrl(`/exports/${encodeURIComponent(label)}/files/${encodeURIComponent(file)}`),
};
