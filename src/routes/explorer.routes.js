import { Router } from 'express';
import * as controller from '../controllers/explorer.controller.js';
import {
  disruptionIdParams,
  disruptionsQuery,
  etaIdParams,
  etasQuery,
  exportFileParams,
  facilitiesQuery,
  facilityDetailQuery,
  facilityIdParams,
  listEventsQuery,
} from '../controllers/schemas.js';
import { validateRequest } from '../middleware/requestValidator.js';

// Read-only exploration endpoints for tracking events, facilities, disruptions, ETA snapshots,
// completed exports and non-sensitive system configuration.
export const eventRouter = Router();
eventRouter.get('/', validateRequest({ query: listEventsQuery }), controller.events);

export const facilityRouter = Router();
facilityRouter.get('/', validateRequest({ query: facilitiesQuery }), controller.facilities);
facilityRouter.get(
  '/:id',
  validateRequest({ params: facilityIdParams, query: facilityDetailQuery }),
  controller.facility,
);

export const disruptionRouter = Router();
disruptionRouter.get('/', validateRequest({ query: disruptionsQuery }), controller.disruptions);
disruptionRouter.get('/timeline', controller.disruptionsTimeline);
disruptionRouter.get('/:id', validateRequest({ params: disruptionIdParams }), controller.disruption);

export const etaRouter = Router();
etaRouter.get('/', validateRequest({ query: etasQuery }), controller.etas);
etaRouter.get('/:id', validateRequest({ params: etaIdParams }), controller.eta);

export const exportRouter = Router();
exportRouter.get('/', controller.exportsList);
exportRouter.get(
  '/:label/files/:file',
  validateRequest({ params: exportFileParams }),
  controller.exportFile,
);

export const systemRouter = Router();
systemRouter.get('/config', controller.systemConfig);
