import { useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import { listOtas } from '../../services/otas.ts';
import './AgenciasOtaPage.css';

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
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} ${part('hour')}:${part('minute')}`;
}

export function AgenciasOtaPage() {
  const query = useQuery({
    queryKey: ['otas'],
    queryFn: ({ signal }) => listOtas(signal),
  });

  return (
    <section className="ota-page">
      {query.isPending && <p>Consultando agencias OTA...</p>}
      {query.isError && <ErrorMessage error={query.error} />}
      {query.isSuccess && query.data.items.length === 0 && (
        <p>No hay agencias OTA registradas.</p>
      )}
      {query.isSuccess && query.data.items.length > 0 && (
        <div className="tablewrap">
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
                  <td>
                    <span
                      className={`badge ${ota.connectionStatus === 'CONNECTED' ? 'ok' : 'err'}`}
                    >
                      {ota.connectionStatus === 'CONNECTED'
                        ? 'Conectada'
                        : 'Desconectada'}
                    </span>
                  </td>
                  <td>{formatDateTime(ota.linkedAt)}</td>
                  <td>{formatDateTime(ota.lastSyncAt)}</td>
                  <td>{ota.activeReservations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
