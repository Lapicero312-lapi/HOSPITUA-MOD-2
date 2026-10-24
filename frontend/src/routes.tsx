import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { RequireUser } from './components/RequireUser.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { RouteErrorPage } from './pages/RouteErrorPage.tsx';

/**
 * Las rutas de la aplicación. Cada caso de uso agrega las de sus pantallas dentro de `Layout`, que
 * exige el nombre de la Recepcionista.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    path: '/',
    element: (
      <RequireUser>
        <Layout />
      </RequireUser>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
