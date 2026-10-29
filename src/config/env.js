import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  MONGODB_URI: z
    .string()
    .min(1)
    .refine(
      (v) => /^mongodb(\+srv)?:\/\//.test(v),
      'MONGODB_URI must be a mongodb:// or mongodb+srv:// URI',
    )
    .default('mongodb://127.0.0.1:27017'),
  MONGODB_DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,60}$/)
    .default('logistics_eta'),
  MONGODB_DB_NAME_TEST: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,60}_test$/, 'MONGODB_DB_NAME_TEST must end with "_test"')
    .default('logistics_eta_test'),
  ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters'),
  REQUEST_BODY_LIMIT: z.string().default('100kb'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  ADMIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  GENERATION_SEED: z.coerce.number().int().nonnegative().default(20261022),
  GENERATION_PROFILE: z.enum(['tiny', 'small', 'full']).default('small'),
  BATCH_SIZE: z.coerce.number().int().min(100).max(10000).default(1000),
  EXPORT_DIR: z.string().min(1).default('exports'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = { ...parsed.data };
  // The automated test-suite always runs against the dedicated *_test database.
  env.ACTIVE_DB_NAME = env.NODE_ENV === 'test' ? env.MONGODB_DB_NAME_TEST : env.MONGODB_DB_NAME;
  return Object.freeze(env);
}

export const env = loadEnv();
