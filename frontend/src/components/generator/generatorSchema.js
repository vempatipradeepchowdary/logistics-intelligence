import { z } from 'zod';

// Mirrors the backend generation-config constraints (src/config/generation.js) so invalid
// configurations are caught in the form before a request is sent. The backend re-validates.
export const PRESETS = {
  tiny: { shipments: 600, trackingEvents: 3600, weatherEvents: 120, simulationDays: 21, anomalyCasesPerVariant: 2 },
  small: { shipments: 5000, trackingEvents: 30000, weatherEvents: 400, simulationDays: 45, anomalyCasesPerVariant: 3 },
  full: { shipments: 50000, trackingEvents: 300000, weatherEvents: 1000, simulationDays: 120, anomalyCasesPerVariant: 4 },
};

const int = (label, min, max) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

export const generatorSchema = z
  .object({
    profile: z.enum(['tiny', 'small', 'full']),
    seed: int('Seed', 0, 4294967295),
    shipments: int('Shipments', 50, 899999),
    trackingEvents: int('Tracking events', 100, 6_000_000),
    weatherEvents: int('Disruption windows', 10, 99999),
    simulationDays: int('Simulation window', 7, 366),
    anomalyCasesPerVariant: int('Anomaly cases per variant', 0, 50),
    batchSize: int('Batch size', 100, 10000),
    mode: z.enum(['reset', 'resume']),
  })
  .superRefine((v, ctx) => {
    const ratio = v.trackingEvents / v.shipments;
    if (ratio < 5.2 || ratio > 6.8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trackingEvents'],
        message: `Events per shipment must be between 5.2 and 6.8 (currently ${ratio.toFixed(2)}); the generator calibrates optional scans to hit the exact total.`,
      });
    }
  });

/** Request body for POST /api/admin/generate: profile + only the values that differ from it. */
export function toGenerateRequest(values) {
  const preset = PRESETS[values.profile];
  const overrides = {};
  for (const key of Object.keys(preset)) {
    if (Number(values[key]) !== preset[key]) overrides[key] = Number(values[key]);
  }
  return {
    profile: values.profile,
    seed: Number(values.seed),
    batchSize: Number(values.batchSize),
    reset: values.mode === 'reset',
    resume: values.mode === 'resume',
    ...(Object.keys(overrides).length ? { overrides } : {}),
  };
}
