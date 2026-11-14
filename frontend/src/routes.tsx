import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { RequireUser } from './components/RequireUser.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { OtasPage } from './pages/otas/OtasPage.tsx';
import { RatesPage } from './pages/rates/RatesPage.tsx';
import { CancelReservationPage } from './pages/reservations/cancel/CancelReservationPage.tsx';
import { ModifyReservationPage } from './pages/reservations/modify/ModifyReservationPage.tsx';
import { NewDirectReservationPage } from './pages/reservations/new/NewDirectReservationPage.tsx';
import { ReservationDetailPage } from './pages/reservations/ReservationDetailPage.tsx';
import { ReservationsPage } from './pages/reservations/ReservationsPage.tsx';
import { RoomsPage } from './pages/rooms/RoomsPage.tsx';
import { RouteErrorPage } from './pages/RouteErrorPage.tsx';
import { SirePage } from './pages/sire/SirePage.tsx';

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
      // Una ruta fija: va antes que `reservas/:reservationRef`, aunque react-router ya la prefiere.
      { path: 'reservas/nueva', element: <NewDirectReservationPage /> },
      { path: 'sire', element: <SirePage /> },
      { path: 'habitaciones', element: <RoomsPage /> },
      { path: 'tarifas', element: <RatesPage /> },
      { path: 'agencias', element: <OtasPage /> },
      {
        path: 'reservas/:reservationRef',
        element: <ReservationDetailPage />,
      },
      {
        path: 'reservas/:reservationRef/cancelar',
        element: <CancelReservationPage />,
      },
      {
        path: 'reservas/:reservationRef/modificar',
        element: <ModifyReservationPage />,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
