/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, `npm run dev:api` runs the Worker (online play) on :8787
// and Vite forwards /api to it, WebSockets included.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
