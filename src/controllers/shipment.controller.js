import {
  getShipmentDetail,
  getShipmentEtas,
  getShipmentEvents,
  getShipmentTimeline,
  listShipments,
} from '../services/shipment.service.js';
import { sendOk } from '../utils/response.js';

export async function list(req, res) {
  const { items, meta } = await listShipments(req.valid.query);
  return sendOk(res, items, meta);
}

export async function detail(req, res) {
  return sendOk(res, await getShipmentDetail(req.valid.params.id));
}

export async function events(req, res) {
  const items = await getShipmentEvents(req.valid.params.id, req.valid.query);
  return sendOk(res, items, {
    count: items.length,
    asOf: req.valid.query.asOf ?? null,
    order: 'occurredAt, sequence',
  });
}

export async function etas(req, res) {
  const items = await getShipmentEtas(req.valid.params.id);
  return sendOk(res, items, { count: items.length, order: 'predictionAt' });
}

export async function timeline(req, res) {
  return sendOk(res, await getShipmentTimeline(req.valid.params.id));
}
