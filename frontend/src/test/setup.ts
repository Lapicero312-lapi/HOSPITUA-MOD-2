import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // El nombre del login simulado no pasa de una prueba a otra.
  sessionStorage.clear();
});
