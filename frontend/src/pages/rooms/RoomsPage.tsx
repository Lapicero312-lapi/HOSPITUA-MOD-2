import { useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import {
  listRooms,
  type Room,
  type RoomMaintenance,
} from '../../services/rooms.ts';
import './RoomsPage.css';

/**
 * Pantalla "Habitaciones" (FR-006): todas las habitaciones vendibles con su número, categoría,
 * capacidad y mantenimiento próximo, en el orden en que las manda el backend. Es solo de lectura y no
 * muestra el estado de la habitación.
 */
export function RoomsPage() {
  return (
    <section className="rooms">
      <h1 className="rooms-title">Habitaciones</h1>
      <div className="rooms-panel">
        <RoomsContent />
      </div>
    </section>
  );
}

function RoomsContent() {
  const rooms = useQuery({
    queryKey: ['rooms'],
    queryFn: ({ signal }) => listRooms(signal),
    // Sin caché (plan, punto 7: el spec pide tiempo real): al salir de la pantalla se descarta la
    // respuesta, y al volver se consulta de nuevo en lugar de mostrar la lista anterior.
    gcTime: 0,
  });

  if (rooms.isPending) {
    return (
      <p className="rooms-state rooms-state--loading">Cargando habitaciones…</p>
    );
  }
  // Si falla el inventario, solo el error: nunca una lista parcial (plan, "Pruebas por escenario").
  if (rooms.isError) {
    return <ErrorMessage error={rooms.error} />;
  }
  if (rooms.data.items.length === 0) {
    return <p className="rooms-state">No hay habitaciones registradas.</p>;
  }
  return <RoomsTable rooms={rooms.data.items} />;
}

function RoomsTable({ rooms }: { rooms: Room[] }) {
  return (
    <table className="rooms-table">
      <thead>
        <tr>
          <th scope="col">N.º</th>
          <th scope="col">Categoría</th>
          <th scope="col">Capacidad</th>
          <th scope="col">Mantenimiento próximo</th>
        </tr>
      </thead>
      <tbody>
        {rooms.map((room) => (
          <tr key={room.id}>
            <td className="rooms-number">{`Hab. ${room.roomNumber}`}</td>
            <td>
              <span className="rooms-category">{room.categoryRoom}</span>
            </td>
            <td className="rooms-capacity">{capacityText(room.maxCapacity)}</td>
            <td>
              <span
                className={`rooms-maintenance rooms-maintenance--${room.maintenance.status.toLowerCase()}`}
              >
                {maintenanceText(room.maintenance)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function capacityText(maxCapacity: number): string {
  return `${maxCapacity} ${maxCapacity === 1 ? 'persona' : 'personas'}`;
}

function maintenanceText(maintenance: RoomMaintenance): string {
  switch (maintenance.status) {
    case 'SCHEDULED':
      return `${formatDate(maintenance.maintenanceStart)} → ${formatDate(maintenance.maintenanceEnd)}`;
    case 'NONE':
      return 'Sin mantenimiento próximo';
    case 'UNAVAILABLE':
      return 'No se pudo consultar el mantenimiento';
  }
}

/** `AAAA-MM-DD` como `dd/mm/aaaa` (plan base, "Fechas"), sin pasar por `Date` ni por la zona horaria. */
function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
