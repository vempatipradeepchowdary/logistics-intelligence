import { z } from 'zod';

/**
 * Generation profiles. "full" is the challenge baseline:
 * 50,000 shipments / 300,000 tracking events / 100 facilities / 1,000 disruption windows.
 */
export const GENERATION_PROFILES = Object.freeze({
  tiny: {
    shipments: 600,
    trackingEvents: 3600,
    facilities: 100,
    weatherEvents: 120,
    simulationStart: '2026-01-01T00:00:00Z',
    simulationDays: 21,
    anomalyCasesPerVariant: 2,
  },
  small: {
    shipments: 5000,
    trackingEvents: 30000,
    facilities: 100,
    weatherEvents: 400,
    simulationStart: '2026-01-01T00:00:00Z',
    simulationDays: 45,
    anomalyCasesPerVariant: 3,
  },
  full: {
    shipments: 50000,
    trackingEvents: 300000,
    facilities: 100,
    weatherEvents: 1000,
    simulationStart: '2026-01-01T00:00:00Z',
    simulationDays: 120,
    anomalyCasesPerVariant: 4,
  },
});

export const GENERATOR_VERSION = 'synthgen-v1.0.0';

export const generationConfigSchema = z
  .object({
    profile: z.enum(['tiny', 'small', 'full', 'custom']),
    seed: z
      .number()
      .int()
      .nonnegative()
      .max(2 ** 32 - 1),
    shipments: z.number().int().min(50).max(899999),
    trackingEvents: z.number().int().min(100),
    facilities: z.literal(100),
    weatherEvents: z.number().int().min(10).max(99999),
    simulationStart: z.string().datetime(),
    simulationDays: z.number().int().min(7).max(366),
    anomalyCasesPerVariant: z.number().int().min(0).max(50),
    batchSize: z.number().int().min(100).max(10000),
  })
  .superRefine((c, ctx) => {
    const ratio = c.trackingEvents / c.shipments;
    if (ratio < 5.2 || ratio > 6.8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trackingEvents/shipments ratio ${ratio.toFixed(2)} is outside the calibratable range [5.2, 6.8]`,
      });
    }
  });

/** Resolve a profile plus overrides into a validated, frozen generation config. */
export function resolveGenerationConfig({
  profile = 'small',
  seed,
  batchSize,
  overrides = {},
} = {}) {
  const base = GENERATION_PROFILES[profile];
  if (!base) throw new Error(`Unknown generation profile "${profile}"`);
  const hasOverrides = Object.keys(overrides).length > 0;
  const merged = {
    ...base,
    ...overrides,
    profile: hasOverrides ? 'custom' : profile,
    seed: seed ?? 20261022,
    batchSize: batchSize ?? 1000,
  };
  return Object.freeze(generationConfigSchema.parse(merged));
}
