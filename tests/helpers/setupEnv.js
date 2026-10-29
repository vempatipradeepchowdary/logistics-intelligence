import os from 'node:os';
import path from 'node:path';

// Runs before any test module is imported, so src/config/env.js sees test settings.
// dotenv never overrides variables that are already set.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? 'test-admin-key-0123456789';
process.env.EXPORT_DIR = path.join(os.tmpdir(), 'logistics-eta-test-exports');
process.env.MONGODB_DB_NAME_TEST = process.env.MONGODB_DB_NAME_TEST ?? 'logistics_eta_test';
