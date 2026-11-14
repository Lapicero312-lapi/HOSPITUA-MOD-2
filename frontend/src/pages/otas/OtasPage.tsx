import { useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import {
  listOtas,
  type Ota,
  type OtaConnectionStatus,
} from '../../services/otas.ts';
import './OtasPage.css';

/**
 * Pantalla "Agencias OTA" (spec de `register-ota-information-commission`, FR-008): las agencias con su
 * comisión, su conexión con Channex, su fecha de vinculación, su última sincronización y sus reservas
 * activas (plan, A3), en el orden en que las manda el backend. Es solo de lectura: la Recepcionista no
 * crea ni edita agencias. Una agencia desconectada sigue en la lista, como "Desconectada".
 */
export function OtasPage() {
  return (
    <section className="otas ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="otas-title ui-page-title">Agencias OTA</h1>
          <p className="ui-page-subtitle">
            Comisión, conexión con Channex y reservas activas de cada agencia.
          </p>
        </div>
      </header>
      <div className="otas-panel ui-panel">
        <OtasContent />
      </div>
    </section>
  );
}

function OtasContent() {
  const otas = useQuery({
    queryKey: ['otas'],
    queryFn: ({ signal }) => listOtas(signal),
  });

  if (otas.isPending) {
    return (
      <p className="otas-state otas-state--loading ui-state ui-state--loading">
        Cargando agencias…
      </p>
    );
  }
  if (otas.isError) {
    return <ErrorMessage error={otas.error} />;
  }
  if (otas.data.items.length === 0) {
    return <p className="otas-state ui-state">No hay agencias registradas.</p>;
  }
  return <OtasTable otas={otas.data.items} />;
}

function OtasTable({ otas }: { otas: Ota[] }) {
  return (
    <div className="ui-scroll-x">
      <table className="otas-table ui-table ui-table--sticky">
        <thead>
          <tr>
            <th scope="col">Agencia</th>
            <th scope="col">Comisión</th>
            <th scope="col">Conexión</th>
            <th scope="col">Vinculada el</th>
            <th scope="col">Última sincronización</th>
            <th scope="col">Reservas activas</th>
          </tr>
        </thead>
        <tbody>
          {otas.map((ota) => (
            <tr key={ota.id}>
              <td className="otas-name">{ota.name}</td>
              <td
                className={
                  ota.commissionPercentage === null
                    ? 'otas-commission otas-commission--none'
                    : 'otas-commission'
                }
              >
                {commissionText(ota.commissionPercentage)}
              </td>
              <td>
                <span
                  className={`otas-connection ui-badge otas-connection--${ota.connectionStatus.toLowerCase()}`}
                >
                  {connectionText(ota.connectionStatus)}
                </span>
              </td>
              <td className="otas-date">{formatDate(ota.linkedAt)}</td>
              <td className="otas-date">{formatDateTime(ota.lastSyncAt)}</td>
              <td className="otas-count">{ota.activeReservations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** El porcentaje con coma decimal y sin ceros de más (`15 %`, `12,5 %`); `null`: aún no tiene. */
function commissionText(commissionPercentage: number | null): string {
  if (commissionPercentage === null) {
    return 'Sin porcentaje';
  }
  return `${String(commissionPercentage).replace('.', ',')} %`;
}

function connectionText(connectionStatus: OtaConnectionStatus): string {
  switch (connectionStatus) {
    case 'CONNECTED':
      return 'Conectada';
    case 'DISCONNECTED':
      return 'Desconectada';
  }
}

/** `2026-03-02T09:14:00-05:00` como `02/03/2026` (plan base, "Fechas"). */
function formatDate(dateTime: string): string {
  const [year, month, day] = dateTime.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * `2026-10-09T07:58:00-05:00` como `09/10/2026 07:58`. La hora se toma del texto, que ya viene en hora de
 * Colombia (A3), sin pasar por `Date` ni por la zona horaria del computador.
 */
function formatDateTime(dateTime: string): string {
  return `${formatDate(dateTime)} ${dateTime.slice(11, 16)}`;
}
