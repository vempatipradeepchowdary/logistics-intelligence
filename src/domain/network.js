// Planned-duration rules shared by the simulator, the ETA engine and the validator.

export const GROUND_SPEED_KMH = 70;
export const GROUND_HANDLING_MINUTES = 30;
export const AIR_SPEED_KMH = 750;
export const AIR_HANDLING_MINUTES = 150;
export const AIR_MIN_GREAT_CIRCLE_KM = 600;
export const ROAD_DISTANCE_FACTOR = 1.2;

export const plannedGroundMinutes = (distanceKm) =>
  Math.round((distanceKm / GROUND_SPEED_KMH) * 60) + GROUND_HANDLING_MINUTES;

export const plannedAirMinutes = (greatCircleKm) =>
  AIR_HANDLING_MINUTES + Math.round((greatCircleKm / AIR_SPEED_KMH) * 60);

/** Planned processing dwell at a facility for a service level. */
export function plannedDwellMinutes(facility, serviceLevel) {
  return Math.max(10, Math.round(facility.baseProcessingMinutes * serviceLevel.handlingFactor));
}

/** Mode and planned minutes for a route leg under a service level. */
export function legTransitPlan(routeLeg, serviceLevel) {
  if (serviceLevel.transportMode === 'AIR' && routeLeg.plannedAirMinutes) {
    return { mode: 'AIR', minutes: routeLeg.plannedAirMinutes };
  }
  return { mode: 'GROUND', minutes: routeLeg.plannedGroundMinutes };
}

export const routeStopIds = (route) => route.stops.map((s) => s.facilityId);

/** Total planned minutes (dwell at every non-final stop + transit) for legs [fromLeg, end). */
export function plannedRemainingMinutes(route, fromLegIndex, facilitiesById, serviceLevel) {
  let total = 0;
  for (let i = fromLegIndex; i < route.legs.length; i += 1) {
    const leg = route.legs[i];
    total += plannedDwellMinutes(facilitiesById.get(leg.fromFacilityId), serviceLevel);
    total += legTransitPlan(leg, serviceLevel).minutes;
  }
  return total;
}

/**
 * Effective physical path of a shipment: planned route stops up to the divergence point,
 * then the current route's stops (identical to planned when there was no reroute).
 */
export function effectivePath(plannedRoute, currentRoute) {
  const planned = routeStopIds(plannedRoute);
  if (!currentRoute || currentRoute.routeId === plannedRoute.routeId) return planned;
  const current = routeStopIds(currentRoute);
  let i = 0;
  while (i < planned.length && i < current.length && planned[i] === current[i]) i += 1;
  return [...planned.slice(0, i), ...current.slice(i)];
}
