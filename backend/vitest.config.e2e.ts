import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
