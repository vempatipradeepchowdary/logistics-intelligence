import { Router } from 'express';
import * as controller from '../controllers/analytics.controller.js';
import {
  classifiedShipmentsQuery,
  dataQualityQuery,
  partitionQuery,
  violationsQuery,
} from '../controllers/schemas.js';
import { validateRequest } from '../middleware/requestValidator.js';

export const analyticsRouter = Router();

const byPartition = validateRequest({ query: partitionQuery });

analyticsRouter.get('/summary', byPartition, controller.summary);
analyticsRouter.get('/delays', byPartition, controller.delays);
analyticsRouter.get('/delays/breakdowns', byPartition, controller.delayBreakdowns);
analyticsRouter.get(
  '/delays/shipments',
  validateRequest({ query: classifiedShipmentsQuery }),
  controller.classifiedShipments,
);
analyticsRouter.get('/eta-accuracy', byPartition, controller.etaAccuracy);
analyticsRouter.get('/eta-accuracy/breakdowns', byPartition, controller.etaBreakdowns);
analyticsRouter.get('/event-volume', byPartition, controller.eventVolume);
analyticsRouter.get(
  '/data-quality',
  validateRequest({ query: dataQualityQuery }),
  controller.dataQuality,
);
analyticsRouter.get(
  '/data-quality/violations',
  validateRequest({ query: violationsQuery }),
  controller.violations,
);
