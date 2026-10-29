import { Router } from 'express';
import * as controller from '../controllers/shipment.controller.js';
import { eventsQuery, listShipmentsQuery, shipmentIdParams } from '../controllers/schemas.js';
import { validateRequest } from '../middleware/requestValidator.js';

export const shipmentRouter = Router();

shipmentRouter.get('/', validateRequest({ query: listShipmentsQuery }), controller.list);
shipmentRouter.get('/:id', validateRequest({ params: shipmentIdParams }), controller.detail);
shipmentRouter.get(
  '/:id/events',
  validateRequest({ params: shipmentIdParams, query: eventsQuery }),
  controller.events,
);
shipmentRouter.get('/:id/eta', validateRequest({ params: shipmentIdParams }), controller.etas);
shipmentRouter.get(
  '/:id/timeline',
  validateRequest({ params: shipmentIdParams }),
  controller.timeline,
);
