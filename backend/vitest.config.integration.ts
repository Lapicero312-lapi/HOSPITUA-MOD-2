import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resuelve los alias de rutas de tsconfig.json (requiere Vite 8).
  resolve: { tsconfigPaths: true },
  test: {
    // Sin globales: cada prueba importa describe, it, expect y vi desde 'vitest'.
    globals: false,
    root: './',
    include: ['test/integration/**/*.spec.ts'],
    // Arranca PostgreSQL y RabbitMQ con Testcontainers (necesita Docker) y aplica las migraciones.
    globalSetup: ['test/integration/global-setup.ts'],
    // Todos los archivos comparten la misma base y la misma cola: se ejecutan de a uno.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
