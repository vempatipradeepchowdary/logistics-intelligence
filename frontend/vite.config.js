import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_BACKEND_ORIGIN || 'http://localhost:3000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // Same-origin /api during development: no CORS configuration needed on the backend.
      proxy: { '/api': { target: backend, changeOrigin: false } },
    },
    preview: { port: 4173, proxy: { '/api': { target: backend } } },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom'] },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.js'],
      include: ['src/**/*.test.{js,jsx}'],
      css: false,
    },
  };
});
