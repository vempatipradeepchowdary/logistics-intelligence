import { ValidationRun } from '../models/index.js';
import { AppError } from '../utils/appError.js';
import { cached } from '../utils/datasetCache.js';

/** Latest validation run with indexes of its violations by record and by shipment. */
export function latestViolationIndex() {
  return cached(
    'violation-index',
    async () => {
      const run = await ValidationRun.findOne({}, { _id: 0 }).sort({ finishedAt: -1 }).lean();
      const byRecord = new Map();
      const byShipment = new Map();
      for (const v of run?.violations ?? []) {
        const brief = { ruleId: v.ruleId, severity: v.severity, classification: v.classification };
        if (!byRecord.has(v.recordId)) byRecord.set(v.recordId, []);
        byRecord.get(v.recordId).push(brief);
        if (v.shipmentId) {
          if (!byShipment.has(v.shipmentId)) byShipment.set(v.shipmentId, []);
          byShipment.get(v.shipmentId).push(v);
        }
      }
      return {
        runId: run?.runId ?? null,
        finishedAt: run?.finishedAt ?? null,
        violations: run?.violations ?? [],
        truncated: Boolean(run?.violationsTruncated),
        byRecord,
        byShipment,
      };
    },
    { includeValidation: true },
  );
}

/** Filterable, paginated view over the latest run's violations. */
export async function listViolations(query) {
  const index = await latestViolationIndex();
  if (!index.runId) {
    throw new AppError('NOT_FOUND', 'No validation run yet; run validation first', 404);
  }
  const needle = query.q?.toUpperCase();
  const rows = index.violations.filter(
    (v) =>
      (!query.severity || v.severity === query.severity) &&
      (!query.ruleId || v.ruleId === query.ruleId) &&
      (!query.entityType || v.entityType === query.entityType) &&
      (!query.classification || v.classification === query.classification) &&
      (!needle ||
        v.recordId?.toUpperCase().includes(needle) ||
        v.shipmentId?.toUpperCase().includes(needle)),
  );
  const start = (query.page - 1) * query.limit;
  const facets = (field) =>
    [...new Set(index.violations.map((v) => v[field]).filter(Boolean))].sort();
  return {
    items: rows.slice(start, start + query.limit),
    meta: {
      page: query.page,
      limit: query.limit,
      total: rows.length,
      totalPages: Math.ceil(rows.length / query.limit),
      runId: index.runId,
      finishedAt: index.finishedAt,
      storedViolationsTruncated: index.truncated,
      facets: {
        severity: facets('severity'),
        ruleId: facets('ruleId'),
        entityType: facets('entityType'),
        classification: facets('classification'),
      },
    },
  };
}
