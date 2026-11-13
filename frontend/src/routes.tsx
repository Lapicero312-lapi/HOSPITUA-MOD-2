import type { RouteObject } from 'react-router';
import Layout from './components/Layout.tsx';
import { RequireUser } from './components/RequireUser.tsx';
import { HomePage } from './pages/HomePage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { OtasPage } from './pages/otas/OtasPage.tsx';
import { RatesPage } from './pages/rates/RatesPage.tsx';
import { CancelReservationPage } from './pages/reservations/cancel/CancelReservationPage.tsx';
import { ReservationDetailPage } from './pages/reservations/ReservationDetailPage.tsx';
import { ReservationsPage } from './pages/reservations/ReservationsPage.tsx';
import { RoomsPage } from './pages/rooms/RoomsPage.tsx';
import { RouteErrorPage } from './pages/RouteErrorPage.tsx';
import { SirePage } from './pages/sire/SirePage.tsx';
import ModifyReservationPage from './pages/ModifyReservationPage.tsx';
import NewDirectReservationPage from './pages/NewDirectReservationPage.tsx';
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
      { path: 'reservas', element: <ReservationsPage /> },
      { path: 'reservas/nueva', element: <NewDirectReservationPage /> },
      {
        path: 'reservas/:reservationRef',
        element: <ReservationDetailPage />,
      },
      { path: 'reservas/:ref/modificar', element: <ModifyReservationPage /> },
      {
        path: 'reservas/:reservationRef/cancelar',
        element: <CancelReservationPage />,
      },
      {
        path: 'reservas/:ref/habitacion',
        element: <PendingPage title="Asignar habitación" />,
      },
      {
        path: 'huespedes',
        element: <PendingPage title="Huéspedes alojados" />,
      },
      { path: 'sire', element: <SirePage /> },
      { path: 'habitaciones', element: <RoomsPage /> },
      { path: 'tarifas', element: <RatesPage /> },
      { path: 'agencias', element: <OtasPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
