import type { RouteObject } from 'react-router';
import Layout from './components/Layout.tsx';
import { RequireUser } from './components/RequireUser.tsx';
import { HomePage } from './pages/HomePage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { RouteErrorPage } from './pages/RouteErrorPage.tsx';
import CancelReservationPage from './pages/CancelReservationPage.tsx';
import ModifyReservationPage from './pages/ModifyReservationPage.tsx';
import NewDirectReservationPage from './pages/NewDirectReservationPage.tsx';
import ReservationDetailPage from './pages/ReservationDetailPage.tsx';
import ReservationsListPage from './pages/ReservationsListPage.tsx';
import PendingPage from './pages/PendingPage.tsx';

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
      { path: 'reservas', element: <ReservationsListPage /> },
      { path: 'reservas/nueva', element: <NewDirectReservationPage /> },
      { path: 'reservas/:ref', element: <ReservationDetailPage /> },
      { path: 'reservas/:ref/modificar', element: <ModifyReservationPage /> },
      { path: 'reservas/:ref/cancelar', element: <CancelReservationPage /> },
      {
        path: 'reservas/:ref/habitacion',
        element: <PendingPage title="Asignar habitación" />,
      },
      {
        path: 'huespedes',
        element: <PendingPage title="Huéspedes alojados" />,
      },
      { path: 'sire', element: <PendingPage title="Exportar SIRE" /> },
      {
        path: 'habitaciones',
        element: <PendingPage title="Habitaciones" />,
      },
      { path: 'tarifas', element: <PendingPage title="Tarifas" /> },
      {
        path: 'agencias',
        element: <PendingPage title="Agencias OTA" />,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
