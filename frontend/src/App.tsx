import { Route, Routes } from 'react-router';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import CancelReservationPage from './pages/CancelReservationPage';
import ModifyReservationPage from './pages/ModifyReservationPage';
import PendingPage from './pages/PendingPage';
import ReservationDetailPage from './pages/ReservationDetailPage';
import ReservationsListPage from './pages/ReservationsListPage';
import NewDirectReservationPage from './pages/NewDirectReservationPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<ReservationsListPage />} />
        <Route path="/reservas" element={<ReservationsListPage />} />
        <Route path="/reservas/nueva" element={<NewDirectReservationPage />} />
        <Route path="/reservas/:ref" element={<ReservationDetailPage />} />
        <Route path="/reservas/:ref/modificar" element={<ModifyReservationPage />} />
        <Route path="/reservas/:ref/cancelar" element={<CancelReservationPage />} />
        <Route path="/reservas/:ref/habitacion" element={<PendingPage title="Asignar habitación" />} />
        <Route path="/huespedes" element={<PendingPage title="Huéspedes alojados" />} />
        <Route path="/sire" element={<PendingPage title="Exportar SIRE" />} />
        <Route path="/habitaciones" element={<PendingPage title="Habitaciones" />} />
        <Route path="/tarifas" element={<PendingPage title="Tarifas" />} />
        <Route path="/agencias" element={<PendingPage title="Agencias OTA" />} />
      </Route>
    </Routes>
  );
}
