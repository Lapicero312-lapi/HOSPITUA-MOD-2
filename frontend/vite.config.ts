/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, las llamadas a /api van al backend (pnpm --filter backend start:dev).
    // La URL se puede cambiar con VITE_API_PROXY en el .env del frontend.
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
