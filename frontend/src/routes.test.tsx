import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { routes } from './routes.tsx';
import { ApiError } from './services/api-client.ts';

const renderAt = (path: string) =>
  render(
    <RouterProvider
      router={createMemoryRouter(routes, { initialEntries: [path] })}
    />,
  );

describe('Rutas', () => {
  it('el inicio muestra el encabezado, la navegación y la pantalla de inicio', () => {
    renderAt('/');

    expect(screen.getByText('HOSPITUA · Recepción')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Principal' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Recepción' }),
    ).toBeInTheDocument();
  });

  it('una ruta que no existe muestra "La página no existe." dentro del marco', () => {
    renderAt('/no-existe');

    expect(
      screen.getByRole('heading', { name: 'La página no existe.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('HOSPITUA · Recepción')).toBeInTheDocument();
  });
});

describe('ErrorMessage', () => {
  it('muestra el mensaje que envió el backend', () => {
    render(
      <ErrorMessage
        error={
          new ApiError('RESERVATION_NOT_FOUND', 'La reserva no existe.', 400)
        }
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'La reserva no existe.',
    );
  });

  it('para un error que no es de la API, un mensaje general', () => {
    render(<ErrorMessage error={new Error('detalle interno')} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No fue posible procesar la solicitud.',
    );
  });
});
