import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import Avatar from '../components/Avatar';
import { ChannelBadge, ConflictBadge, ErrorBox, StatusBadge } from '../components/Badges';
import { getReservation } from '../services/reservations';
import { canChange, categoryLabel, changeBlockReason, formatDate, formatMoney, LOCK_LONG, MIGRATION, STAY_LABEL } from '../utils/format';

const Kv = ({ k, v }: { k: string; v: React.ReactNode }) => <div><div className="k">{k}</div><div className="v">{v ?? '—'}</div></div>;

export default function ReservationDetailPage() {
  const { ref = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<'stay' | 'guest'>('stay');
  const { data: r, error, isPending } = useQuery({ queryKey: ['reservation', ref], queryFn: () => getReservation(ref) });
  if (isPending) return <p className="note">Cargando reserva…</p>;
  if (error) return <><Link className="crumbnav" to="/reservas">← Volver a reservas</Link><ErrorBox error={error} /></>;

  const editable = canChange(r.status, r.source);
  const reason = changeBlockReason(r.status, r.otaName);
  const lock = LOCK_LONG[r.status] ?? (r.source === 'OTA' ? `🔗 Reserva de ${r.otaName}. Sus cambios y su cancelación los gestiona la agencia, no se editan desde recepción.` : '');
  const foreign = (r.guest.nationality ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() !== 'colombia';
  // El detalle (C3) no trae migrationStatus ni movimientos: llegan con el plan de process-guest-data.
  const migKey = r.status === 'ACTIVE' || r.status === 'PENDING' ? 'AWAITING_CHECK_IN' : r.status === 'CANCELLED' || r.status === 'NO_SHOW' ? 'NO_CHECK_IN' : null;
  const fullName = `${r.guest.firstName} ${r.guest.lastName}`;

  return (
    <>
      <Link className="crumbnav" to="/reservas">← Volver a reservas</Link>
      <div className="pagehead">
        <div><h2>{r.reservationRef}</h2>
          <div className="badges"><StatusBadge status={r.status} /><ChannelBadge source={r.source} otaName={r.otaName} /><ConflictBadge conflict={r.conflict} />
            {r.externalConfirmationCode && <span className="note">Cód. OTA {r.externalConfirmationCode}</span>}</div></div>
        <div className="rowacts">
          <button className="btn" disabled={!editable} title={editable ? '' : reason} onClick={() => nav('modificar')}>Modificar</button>
          <button className="btn danger" disabled={!editable} title={editable ? '' : reason} onClick={() => nav('cancelar')}>Cancelar reserva</button>
        </div>
      </div>
      {lock && <div className="lockbox">{lock}</div>}

      <div className="panel">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'stay'} className={`tab${tab === 'stay' ? ' active' : ''}`} onClick={() => setTab('stay')}>Estadía y tarifa</button>
          <button role="tab" aria-selected={tab === 'guest'} className={`tab${tab === 'guest' ? ' active' : ''}`} onClick={() => setTab('guest')}>Datos del huésped y migración</button>
        </div>

        {tab === 'stay' && <>
          <div className="kv">
            <Kv k="Entrada" v={formatDate(r.startDate)} /><Kv k="Salida" v={formatDate(r.endDate)} /><Kv k="Noches" v={r.nights} /><Kv k="Personas" v={r.guestCount} />
            <Kv k="Observaciones" v={r.notes || '—'} /><Kv k="Creada el" v={formatDate(r.createdAt)} />
            {r.conflict && <Kv k="Conflicto" v={`${r.conflict.reason} · ${formatDate(r.conflict.detectedAt)}`} />}
          </div>
          <div className="tablewrap" style={{ marginTop: 16 }}><table>
            <thead><tr><th>Habitación</th><th>Categoría</th><th>Personas</th><th>Valor bruto</th><th>Estado en la reserva</th></tr></thead>
            <tbody>{r.rooms.map((x, i) => (
              <tr key={i}><td>{x.roomNumber ? `Hab. ${x.roomNumber}` : 'Sin asignar'}</td><td>{categoryLabel(x.categoryRoom)}</td><td>{x.guestCount}</td>
                <td>{formatMoney(x.roomGrossAmount)}</td><td><span className="badge neutral">{STAY_LABEL[x.stayStatus]}</span></td></tr>))}
            </tbody>
          </table></div>
        </>}

        {tab === 'guest' && <>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="person"><Avatar name={fullName} /><div><b>{fullName}</b> <span className="note">· titular</span><br />
              <span className="note">{r.guest.documentType ? `${r.guest.documentType} ${r.guest.documentNumber}` : 'Documento no informado por la agencia'}</span></div></div>
            <span className="note">{r.guest.nationality ?? '—'} · {foreign ? 'huésped extranjero' : 'huésped nacional'}</span>
          </div>
          <div className="kv" style={{ margin: '12px 0' }}><Kv k="Teléfono" v={r.guest.contactPhone} /><Kv k="Email" v={r.guest.contactEmail} /></div>
          {migKey
            ? <div className="readonly-banner">{MIGRATION[migKey].tip}.</div>
            : <div className="readonly-banner">El detalle de movimientos migratorios se mostrará cuando exista el plan de <span className="code">process-guest-data</span>.</div>}
        </>}
      </div>

      {r.cancellation && <div className="panel"><h2>Cancelación</h2><div className="kv">
        <Kv k="Fecha" v={formatDate(r.cancellation.cancellationDate)} /><Kv k="Canal" v={r.cancellation.channel === 'OTA_API' ? 'Agencia (API)' : 'Recepción'} />
        <Kv k="Procesada por" v={r.cancellation.processedBy} /><Kv k="Motivo" v={r.cancellation.reason ?? 'Sin motivo'} /></div></div>}
    </>
  );
}
