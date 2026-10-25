import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { routes } from './routes.tsx';
import { ApiError } from './services/api-client.ts';
import { currentUser, signIn } from './services/session.ts';

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

describe('Rutas', () => {
  it('el inicio muestra el encabezado, la navegación, la Recepcionista y la pantalla de inicio', () => {
    signIn('Ana Pérez');
    renderAt('/');

    expect(screen.getByText('HOSPITUA · Recepción')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Principal' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Recepcionista: Ana Pérez/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Recepción' }),
    ).toBeInTheDocument();
  });

  it('una ruta que no existe muestra "La página no existe." dentro del marco', () => {
    signIn('Ana Pérez');
    renderAt('/no-existe');

    expect(
      screen.getByRole('heading', { name: 'La página no existe.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('HOSPITUA · Recepción')).toBeInTheDocument();
  });
});

describe('Login simulado', () => {
  it('sin nombre, una pantalla lleva al login', () => {
    const router = renderAt('/no-existe');

    expect(router.state.location.pathname).toBe('/login');
    expect(
      screen.getByLabelText('Nombre de la Recepcionista'),
    ).toBeInTheDocument();
  });

  it('con el nombre, guarda la Recepcionista y vuelve a la pantalla pedida', async () => {
    const user = userEvent.setup();
    const router = renderAt('/no-existe?pagina=2');

    await user.type(
      screen.getByLabelText('Nombre de la Recepcionista'),
      '  Ana Pérez ',
    );
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(currentUser()).toBe('Ana Pérez');
    expect(router.state.location.pathname).toBe('/no-existe');
    expect(router.state.location.search).toBe('?pagina=2');
    expect(screen.getByText(/Recepcionista: Ana Pérez/)).toBeInTheDocument();
  });

  it('sin escribir el nombre, lo pide y no entra', async () => {
    const user = userEvent.setup();
    const router = renderAt('/login');

    await user.type(screen.getByLabelText('Nombre de la Recepcionista'), '   ');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Escriba su nombre.');
    expect(currentUser()).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('un nombre de más de 100 caracteres no entra', async () => {
    const user = userEvent.setup();
    renderAt('/login');

    await user.type(
      screen.getByLabelText('Nombre de la Recepcionista'),
      'a'.repeat(101),
    );
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'El nombre no puede superar 100 caracteres.',
    );
    expect(currentUser()).toBeNull();
  });

  it('el login sin pantalla pedida lleva al inicio', async () => {
    const user = userEvent.setup();
    const router = renderAt('/login');

    await user.type(
      screen.getByLabelText('Nombre de la Recepcionista'),
      'Ana Pérez',
    );
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(router.state.location.pathname).toBe('/');
  });

  it('"Salir" olvida a la Recepcionista y vuelve al login', async () => {
    const user = userEvent.setup();
    signIn('Ana Pérez');
    const router = renderAt('/');

    await user.click(screen.getByRole('button', { name: 'Salir' }));

    expect(currentUser()).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('con la Recepcionista ya guardada, el login lleva al inicio', () => {
    signIn('Ana Pérez');
    const router = renderAt('/login');

    expect(router.state.location.pathname).toBe('/');
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
