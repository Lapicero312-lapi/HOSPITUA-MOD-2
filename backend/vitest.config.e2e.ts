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
    // Todos los archivos comparten la misma base, como en las de integración: se ejecutan de a uno. En
    // paralelo, la recuperación del cierre del día (`CloseDayJob`, al arrancar cada aplicación con su
    // `Clock`) pasaría a `NO_SHOW` las reservas que otro archivo acaba de guardar en días anteriores.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Sin logs en la salida de las pruebas; las de logs usan su propio destino.
    env: { LOG_LEVEL: 'silent' },
  },
});
