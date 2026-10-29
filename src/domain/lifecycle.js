import { toMs } from '../utils/time.js';

// Shipment lifecycle state machine. Tracking events drive status transitions.
// DELIVERED is terminal: nothing may follow it without a documented correction workflow
// (no correction event type exists in this dataset, so any later event is illegal).

export const EVENT_STATUS = Object.freeze({
  PICKED_UP: 'PICKED_UP',
  ARRIVED_AT_FACILITY: 'IN_TRANSIT',
  DEPARTED_FACILITY: 'IN_TRANSIT',
  ROUTE_CHANGED: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERY_ATTEMPTED: 'EXCEPTION',
  EXCEPTION: 'EXCEPTION',
  DELIVERED: 'DELIVERED',
});

export const ALLOWED_TRANSITIONS = Object.freeze({
  CREATED: ['PICKED_UP', 'EXCEPTION'],
  PICKED_UP: ['IN_TRANSIT', 'EXCEPTION'],
  IN_TRANSIT: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'EXCEPTION'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'EXCEPTION'],
  EXCEPTION: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'EXCEPTION', 'DELIVERED'],
  DELIVERED: [],
});

export const INITIAL_STATUS = 'CREATED';

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Canonical event order: occurrence time, then per-shipment sequence. */
export function compareEvents(a, b) {
  const diff = toMs(a.occurredAt) - toMs(b.occurredAt);
  if (diff !== 0) return diff;
  return (a.sequence ?? 0) - (b.sequence ?? 0);
}

/**
 * Replay events (sorted by occurrence) through the state machine.
 * Illegal transitions are reported and skipped, so the derived status reflects only legal history.
 */
export function deriveStatus(events) {
  const sorted = [...events].sort(compareEvents);
  let status = INITIAL_STATUS;
  let statusUpdatedAt = null;
  const illegal = [];
  for (const event of sorted) {
    const next = EVENT_STATUS[event.eventType];
    if (!next) {
      illegal.push({ event, from: status, to: null });
      continue;
    }
    if (!canTransition(status, next)) {
      illegal.push({ event, from: status, to: next });
      continue;
    }
    status = next;
    statusUpdatedAt = event.occurredAt;
  }
  return { status, statusUpdatedAt, illegal };
}

/** An open exception is a DAMAGED hold with no later progress scan. */
export function hasOpenException(events) {
  let open = false;
  for (const event of [...events].sort(compareEvents)) {
    if (event.eventType === 'EXCEPTION' && event.exceptionCode === 'DAMAGED') open = true;
    else if (
      ['ARRIVED_AT_FACILITY', 'DEPARTED_FACILITY', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(
        event.eventType,
      )
    ) {
      open = false;
    }
  }
  return open;
}
