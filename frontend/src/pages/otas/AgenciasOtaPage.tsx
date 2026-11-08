import { useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import { listOtas } from '../../services/otas.ts';

function formatPercentage(value: number | null): string {
  if (value === null) {
    return 'Sin registrar';
  }
  return `${new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} %`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AgenciasOtaPage() {
  const query = useQuery({
    queryKey: ['otas'],
    queryFn: listOtas,
  });

  return (
    <section>
      <h1>Agencias OTA</h1>

      {query.isPending && <p>Consultando agencias OTA...</p>}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && query.data.items.length === 0 && (
        <p>No hay agencias OTA registradas.</p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <table className="ota-table">
          <caption className="visually-hidden">
            Agencias OTA registradas
          </caption>
          <thead>
            <tr>
              <th scope="col">Agencia</th>
              <th scope="col">Comisión</th>
              <th scope="col">Estado de conexión</th>
              <th scope="col">Vinculada</th>
              <th scope="col">Última sincronización</th>
              <th scope="col">Reservas activas</th>
            </tr>
          </thead>
          <tbody>
            {query.data.items.map((ota) => (
              <tr key={ota.id}>
                <td>{ota.name}</td>
                <td>{formatPercentage(ota.commissionPercentage)}</td>
                <td
                  className={`ota-status ota-status-${ota.connectionStatus.toLowerCase()}`}
                >
                  {ota.connectionStatus === 'CONNECTED'
                    ? 'Conectada'
                    : 'Desconectada'}
                </td>
                <td>{formatDateTime(ota.linkedAt)}</td>
                <td>{formatDateTime(ota.lastSyncAt)}</td>
                <td>{ota.activeReservations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
