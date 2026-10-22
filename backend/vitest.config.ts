import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resuelve los alias de rutas de tsconfig.json (requiere Vite 8).
  resolve: { tsconfigPaths: true },
  test: {
    // Sin globales: cada prueba importa describe, it, expect y vi desde 'vitest'.
    globals: false,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
