import { defineConfig } from 'vitest/config';

// Full-volume acceptance run (50k shipments / 300k events). Takes several minutes.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/acceptance/fullVolume.test.js'],
    setupFiles: ['tests/helpers/setupEnv.js'],
    env: { RUN_FULL_VOLUME: '1' },
    fileParallelism: false,
    testTimeout: 3600000,
    hookTimeout: 3600000,
  },
});
