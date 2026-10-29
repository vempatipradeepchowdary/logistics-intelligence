import {
  getDataQuality,
  getDelayAnalytics,
  getEtaAccuracy,
  getSummary,
} from '../services/analytics.service.js';
import {
  getDelayBreakdowns,
  getEtaBreakdowns,
  getEventVolume,
  listClassifiedShipments,
} from '../services/insights.service.js';
import { listViolations } from '../services/quality.service.js';
import { cached } from '../utils/datasetCache.js';
import { sendOk } from '../utils/response.js';

// Read-only dataset aggregates are memoised per dataset version (see utils/datasetCache.js).
const byPartition = (name, fn) => (req) =>
  cached(`${name}:${req.valid.query.partition}`, () => fn(req.valid.query));

const summaryCached = byPartition('summary', getSummary);
const delaysCached = byPartition('delays', getDelayAnalytics);
const etaAccuracyCached = byPartition('eta-accuracy', getEtaAccuracy);

export const summary = async (req, res) => sendOk(res, await summaryCached(req));
export const delays = async (req, res) => sendOk(res, await delaysCached(req));
export const etaAccuracy = async (req, res) => sendOk(res, await etaAccuracyCached(req));
export const dataQuality = async (req, res) => sendOk(res, await getDataQuality(req.valid.query));
export const etaBreakdowns = async (req, res) =>
  sendOk(res, await getEtaBreakdowns(req.valid.query.partition));
export const delayBreakdowns = async (req, res) =>
  sendOk(res, await getDelayBreakdowns(req.valid.query.partition));
export const eventVolume = async (req, res) =>
  sendOk(res, await getEventVolume(req.valid.query.partition));
export async function classifiedShipments(req, res) {
  const { items, meta } = await listClassifiedShipments(req.valid.query);
  return sendOk(res, items, meta);
}
export async function violations(req, res) {
  const { items, meta } = await listViolations(req.valid.query);
  return sendOk(res, items, meta);
}
