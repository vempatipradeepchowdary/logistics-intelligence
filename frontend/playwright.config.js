import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a REAL backend that serves the built frontend
// (npm run build here, then `npm start` in the repository root with a generated dataset).
// E2E_BASE_URL defaults to the backend's default port; E2E_ADMIN_KEY enables admin workflows.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.js/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.js/ },
  ],
});
