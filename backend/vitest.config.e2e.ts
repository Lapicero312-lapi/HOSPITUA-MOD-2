import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Sin logs en la salida de las pruebas; las de logs usan su propio destino.
    env: { LOG_LEVEL: 'silent' },
  },
});
