import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChannelBadge, ErrorBox, StatusBadge } from '../components/Badges';
import { ApiError } from '../services/apiClient';
import { cancelReservation, getReservation } from '../services/reservations';
import {
  canChange,
  categoryLabel,
  changeBlockReason,
  formatDate,
} from '../utils/format';

export default function CancelReservationPage() {
  const { ref = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState('');
  const {
    data: r,
    error,
    isPending,
  } = useQuery({
    queryKey: ['reservation', ref],
    queryFn: () => getReservation(ref),
  });
  const cancel = useMutation({
    mutationFn: () =>
      cancelReservation(ref, {
        updatedAt: r!.updatedAt ?? '',
        acknowledged: ack,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservation', ref] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['day-summary'] });
      nav(`/reservas/${ref}`);
    },
  });
  const back = (
    <Link className="crumbnav" to={`/reservas/${ref}`}>
      ← Volver al detalle
    </Link>
  );
  if (isPending) return <p className="note">Cargando reserva…</p>;
  if (error)
    return (
      <>
        {back}
        <ErrorBox error={error} />
      </>
    );
  if (!canChange(r.status, r.source))
    return (
      <>
        {back}
        <div className="lockbox" style={{ marginTop: 10 }}>
          🔒 {changeBlockReason(r.status, r.otaName)}.
        </div>
      </>
    );

  const concurrent =
    cancel.error instanceof ApiError &&
    cancel.error.errorCode === 'CONCURRENT_UPDATE';
  return (
    <>
      {back}
      <div className="panel" style={{ marginTop: 10 }}>
        <h2>Reserva a cancelar</h2>
        <div className="pagehead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>{r.reservationRef}</h2>
            <div className="badges">
              <StatusBadge status={r.status} />
              <ChannelBadge source={r.source} otaName={r.otaName} />
            </div>
          </div>
        </div>
        <div className="kv">
          <div>
            <div className="k">Titular</div>
            <div className="v">
              {r.guest.firstName} {r.guest.lastName}
            </div>
          </div>
          <div>
            <div className="k">Estadía</div>
            <div className="v">
              {formatDate(r.startDate)} → {formatDate(r.endDate)}
            </div>
          </div>
          <div>
            <div className="k">Habitaciones</div>
            <div className="v">
              {r.rooms
                .map(
                  (x) =>
                    `Hab. ${x.roomNumber} · ${categoryLabel(x.categoryRoom)}`,
                )
                .join(', ')}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Confirmación</h2>
        <div className="field">
          <label htmlFor="rs">Motivo (opcional)</label>
          <textarea
            id="rs"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Máximo 500 caracteres"
          />
          <span className="note">{reason.length}/500</span>
        </div>
        <label className="check" style={{ margin: '12px 0' }}>
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />{' '}
          Entiendo que la cancelación no se puede deshacer.
        </label>
        {cancel.error && <ErrorBox error={cancel.error} />}
        {concurrent && (
          <button
            className="btn"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ['reservation', ref] })
            }
          >
            Recargar la reserva
          </button>
        )}
        <div className="row">
          <button
            className="btn danger-solid"
            disabled={!ack || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
          </button>
          <Link className="btn" to={`/reservas/${ref}`}>
            Volver sin cancelar
          </Link>
        </div>
        <p className="note">
          La cancelación no genera cobro ni penalidad desde esta pantalla.
        </p>
      </div>
    </>
  );
}
