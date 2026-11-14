import { defineConfig } from 'vitest/config';

/**
 * La prueba contra Channex staging (`generate-ota-reservation`, T012): `pnpm test:staging`. No entra en
 * `pnpm test`, en la integración ni en el CI. Arranca PostgreSQL y RabbitMQ con Testcontainers, como la
 * integración, y llama al Channex de staging con la configuración de quien la corre.
 */
export default defineConfig({
  // Resuelve los alias de rutas de tsconfig.json (requiere Vite 8).
  resolve: { tsconfigPaths: true },
  test: {
    // Sin globales: cada prueba importa describe, it, expect y vi desde 'vitest'.
    globals: false,
    root: './',
    include: ['test/staging/**/*.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    // Cada paso espera a que quien la corre haga su parte en Booking: su propio tiempo va en cada prueba.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { LOG_LEVEL: 'silent' },
  },
});
