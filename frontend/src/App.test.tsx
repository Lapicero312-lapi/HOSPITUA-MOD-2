import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App.tsx';

// Prueba de humo: confirma que Vitest, Testing Library y jsdom funcionan.
// Se reemplaza cuando exista la primera pantalla real (tarea T016 del plan base).
describe('App', () => {
  it('muestra el contador y lo incrementa al hacer clic', async () => {
    render(<App />);

    const boton = screen.getByRole('button', { name: /count is 0/i });
    await userEvent.click(boton);

    expect(
      screen.getByRole('button', { name: /count is 1/i }),
    ).toBeInTheDocument();
  });
});
