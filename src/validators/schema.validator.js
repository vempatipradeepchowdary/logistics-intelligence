import { DATASET_ENTITIES } from '../models/index.js';

const SAMPLE_LIMIT = 25;
const isMissing = (expr) => ({ $in: [{ $type: expr }, ['missing', 'null']] });

/**
 * Derive field-level checks (required / enum / format) from a Mongoose schema, including fields of
 * single-nested subdocuments (checked only when the parent subdocument exists).
 */
export function deriveFieldChecks(schema, prefix = '', parentPath = null) {
  const checks = [];
  schema.eachPath((path, type) => {
    if (path === '_id') return;
    const full = `${prefix}${path}`;
    const guard = parentPath ? { $eq: [{ $type: `$${parentPath}` }, 'object'] } : true;
    if (type.schema && type.instance === 'Embedded') {
      checks.push(...deriveFieldChecks(type.schema, `${full}.`, full));
    }
    if (type.isRequired) {
      checks.push({
        ruleId: 'SCHEMA_REQUIRED_FIELD',
        path: full,
        expr: { $and: [guard, isMissing(`$${full}`)] },
        filter: parentPath
          ? {
              [parentPath]: { $type: 'object' },
              $or: [{ [full]: { $exists: false } }, { [full]: null }],
            }
          : { $or: [{ [full]: { $exists: false } }, { [full]: null }] },
        expected: 'present, non-null',
      });
    }
    const enumValues = (type.enumValues ?? []).filter((v) => v !== null);
    if (enumValues.length && type.instance === 'String') {
      checks.push({
        ruleId: 'SCHEMA_ENUM_VALUE',
        path: full,
        expr: {
          $and: [
            guard,
            { $not: [isMissing(`$${full}`)] },
            { $not: [{ $in: [`$${full}`, enumValues] }] },
          ],
        },
        filter: { [full]: { $exists: true, $nin: [...enumValues, null] } },
        expected: `one of ${enumValues.join(', ')}`,
      });
    }
    const match = type.options?.match;
    if (match instanceof RegExp && type.instance === 'String') {
      checks.push({
        ruleId: 'SCHEMA_ID_FORMAT',
        path: full,
        expr: {
          $and: [
            guard,
            { $eq: [{ $type: `$${full}` }, 'string'] },
            { $not: [{ $regexMatch: { input: `$${full}`, regex: match } }] },
          ],
        },
        filter: { [full]: { $type: 'string', $not: match } },
        expected: `matches ${match}`,
      });
    }
  });
  return checks;
}

/** Required fields, enums, ID formats and business-ID uniqueness for every dataset collection. */
export async function validateSchemas(collector) {
  for (const { entity, model, idField } of DATASET_ENTITIES) {
    const total = await model.estimatedDocumentCount();
    collector.countRecords(entity, total);
    const checks = deriveFieldChecks(model.schema);
    const group = { _id: null };
    checks.forEach((c, i) => {
      group[`c${i}`] = { $sum: { $cond: [c.expr, 1, 0] } };
    });
    const [counts] = total ? await model.aggregate([{ $group: group }]).allowDiskUse(true) : [{}];
    for (const [i, c] of checks.entries()) {
      const failed = counts?.[`c${i}`] ?? 0;
      const samples = failed
        ? await model
            .find(c.filter, { [idField]: 1, shipmentId: 1, [c.path]: 1, _id: 0 })
            .limit(SAMPLE_LIMIT)
            .lean()
        : [];
      collector.bulk(c.ruleId, total, failed, samples, (doc) => ({
        entityType: entity,
        recordId: doc[idField] ?? '(unknown)',
        shipmentId: doc.shipmentId ?? null,
        expected: `${c.path}: ${c.expected}`,
        actual: `${c.path}: ${JSON.stringify(c.path.split('.').reduce((o, k) => o?.[k], doc) ?? null)}`,
      }));
    }

    const duplicates = await model
      .aggregate([
        { $group: { _id: `$${idField}`, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $limit: SAMPLE_LIMIT },
      ])
      .allowDiskUse(true);
    collector.bulk('UNIQUE_BUSINESS_ID', total, duplicates.length, duplicates, (d) => ({
      entityType: entity,
      recordId: d._id,
      expected: `${idField} unique`,
      actual: `${d.n} documents share this ID`,
    }));
  }
}
