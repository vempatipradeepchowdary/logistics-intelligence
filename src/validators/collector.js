import { RULES, RULES_BY_ID } from './rules.js';

const BLOCKING = new Set(['ERROR', 'CRITICAL']);

/**
 * Accumulates check outcomes per rule and classifies every failure as either an
 * INTENTIONAL_ANOMALY (the shipment carries a labelled anomaly case that expects this rule)
 * or UNEXPECTED (a genuine defect). Nothing is suppressed: intentional failures are still failures.
 */
export class ValidationCollector {
  constructor(anomalyCases = [], { maxViolations = 50000 } = {}) {
    this.maxViolations = maxViolations;
    this.rules = new Map(
      RULES.map((r) => [
        r.ruleId,
        { ...r, checked: 0, passed: 0, failed: 0, intentional: 0, unexpected: 0 },
      ]),
    );
    this.cases = anomalyCases;
    this.casesByShipment = new Map();
    for (const c of anomalyCases) {
      if (!this.casesByShipment.has(c.shipmentId)) this.casesByShipment.set(c.shipmentId, []);
      this.casesByShipment.get(c.shipmentId).push(c);
    }
    this.detected = new Map(anomalyCases.map((c) => [c.anomalyId, new Set()]));
    this.violations = [];
    this.truncated = false;
    this.recordsChecked = {};
  }

  rule(ruleId) {
    const r = this.rules.get(ruleId);
    if (!r) throw new Error(`Unknown validation rule ${ruleId}`);
    return r;
  }

  countRecords(entity, n) {
    this.recordsChecked[entity] = (this.recordsChecked[entity] ?? 0) + n;
  }

  pass(ruleId, n = 1) {
    const r = this.rule(ruleId);
    r.checked += n;
    r.passed += n;
  }

  /**
   * @param {string} ruleId
   * @param {object} v { recordId, shipmentId?, entityType?, expected, actual, explanation }
   */
  fail(ruleId, v) {
    const r = this.rule(ruleId);
    r.checked += 1;
    r.failed += 1;
    const match = (this.casesByShipment.get(v.shipmentId) ?? []).find((c) =>
      c.expectedRuleIds.includes(ruleId),
    );
    if (match) {
      r.intentional += 1;
      this.detected.get(match.anomalyId).add(ruleId);
    } else r.unexpected += 1;
    const violation = {
      ruleId,
      severity: r.severity,
      entityType: v.entityType ?? r.entityType,
      recordId: v.recordId,
      shipmentId: v.shipmentId ?? null,
      status: 'FAILED',
      classification: match ? 'INTENTIONAL_ANOMALY' : 'UNEXPECTED',
      anomalyId: match?.anomalyId ?? null,
      expected: v.expected,
      actual: v.actual,
      explanation: v.explanation ?? r.description,
      recommendedCorrection: v.recommendation ?? RULES_BY_ID.get(ruleId).recommendation,
    };
    if (this.violations.length < this.maxViolations) this.violations.push(violation);
    else this.truncated = true;
  }

  /** Convenience: one check; `violation` is a thunk evaluated only on failure. */
  check(ruleId, ok, violation) {
    if (ok) this.pass(ruleId);
    else this.fail(ruleId, violation());
    return ok;
  }

  /** Aggregate-level result: `failedCount` failures of which `samples` are itemised. */
  bulk(ruleId, checked, failedCount, samples, buildViolation) {
    this.pass(ruleId, checked - failedCount);
    for (const sample of samples) this.fail(ruleId, buildViolation(sample));
    const unsampled = failedCount - samples.length;
    if (unsampled > 0) {
      const r = this.rule(ruleId);
      r.checked += unsampled;
      r.failed += unsampled;
      r.unexpected += unsampled;
    }
  }

  coverage() {
    return this.cases.map((c) => {
      const detectedRuleIds = [...this.detected.get(c.anomalyId)].sort();
      const missingRuleIds = c.expectedRuleIds.filter((r) => !detectedRuleIds.includes(r));
      return {
        anomalyId: c.anomalyId,
        scenario: c.scenario,
        variant: c.variant,
        shipmentId: c.shipmentId,
        expectedRuleIds: c.expectedRuleIds,
        detectedRuleIds,
        missingRuleIds,
        detected: missingRuleIds.length === 0,
      };
    });
  }

  report() {
    const rules = [...this.rules.values()];
    const sum = (key) => rules.reduce((s, r) => s + r[key], 0);
    const unexpectedViolations = this.violations.filter((v) => v.classification === 'UNEXPECTED');
    const unexpectedBlocking = rules
      .filter((r) => BLOCKING.has(r.severity))
      .reduce((s, r) => s + r.unexpected, 0);
    const unexpectedWarnings = rules
      .filter((r) => !BLOCKING.has(r.severity))
      .reduce((s, r) => s + r.unexpected, 0);
    const coverage = this.coverage();
    const missed = coverage.filter((c) => !c.detected).length;
    const summary = {
      totalRecordsChecked: Object.values(this.recordsChecked).reduce((s, n) => s + n, 0),
      recordsCheckedByEntity: this.recordsChecked,
      totalChecks: sum('checked'),
      passedChecks: sum('passed'),
      failedChecks: sum('failed'),
      intentionalAnomalies: sum('intentional'),
      unexpectedErrors: unexpectedBlocking,
      unexpectedWarnings,
      anomalyCasesExpected: coverage.length,
      anomalyCasesDetected: coverage.length - missed,
      missedAnomalies: missed,
      unexpectedViolationSample: unexpectedViolations
        .slice(0, 20)
        .map((v) => `${v.ruleId}:${v.recordId}`),
    };
    return {
      status: unexpectedBlocking === 0 && missed === 0 ? 'PASS' : 'FAIL',
      summary,
      rules: rules.map(({ recommendation: _r, ...r }) => r),
      anomalyCoverage: coverage,
      violations: this.violations,
      violationsTruncated: this.truncated,
    };
  }
}
