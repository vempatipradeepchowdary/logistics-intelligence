import { listEvents } from '../services/event.service.js';
import {
  disruptionTimeline,
  getDisruption,
  getFacility,
  listDisruptions,
  listFacilities,
} from '../services/facility.service.js';
import { getEta, listEtas } from '../services/etaInsight.service.js';
import { listExports, resolveExportFile } from '../services/export.service.js';
import { getSystemConfig } from '../services/system.service.js';
import { sendOk } from '../utils/response.js';

const page = (res, { items, meta }) => sendOk(res, items, meta);

export const events = async (req, res) => page(res, await listEvents(req.valid.query));
export const facilities = async (req, res) => page(res, await listFacilities(req.valid.query));
export const facility = async (req, res) =>
  sendOk(res, await getFacility(req.valid.params.id, req.valid.query));
export const disruptions = async (req, res) => page(res, await listDisruptions(req.valid.query));
export const disruptionsTimeline = async (_req, res) => sendOk(res, await disruptionTimeline());
export const disruption = async (req, res) => sendOk(res, await getDisruption(req.valid.params.id));
export const etas = async (req, res) => page(res, await listEtas(req.valid.query));
export const eta = async (req, res) => sendOk(res, await getEta(req.valid.params.id));
export const exportsList = async (_req, res) => {
  const items = await listExports();
  return sendOk(res, items, { count: items.length });
};
export async function exportFile(req, res) {
  const target = await resolveExportFile(req.valid.params.label, req.valid.params.file);
  return res.download(target, req.valid.params.file);
}
export const systemConfig = async (_req, res) => sendOk(res, await getSystemConfig());
