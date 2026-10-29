import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/acceptance/fullVolume.test.js', 'node_modules/**'],
    setupFiles: ['tests/helpers/setupEnv.js'],
    globalSetup: ['tests/helpers/globalSetup.js'],
    // Integration/acceptance suites share one isolated *_test database, so files run serially.
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 300000,
  },
});
