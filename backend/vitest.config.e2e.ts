import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // AppModule usa la base de datos: se arranca la de Testcontainers (necesita Docker), como en las de
    // integración, y su entorno se asigna antes de importar cada prueba.
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/e2e/support/integration-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Sin logs en la salida de las pruebas; las de logs usan su propio destino.
    env: { LOG_LEVEL: 'silent' },
  },
});
