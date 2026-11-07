import type {
  CancelRequest,
  ModificationBody,
  ModificationPreview,
  ReservationDetail,
} from '../types';
import {
  MAINTENANCE,
  OPERATIONAL_DATE,
  RATES,
  RESERVATIONS,
  ROOMS,
} from './data';

// Lógica pura de update-reservation (B1/B2) y cancel-reservation (A): errores y orden de validación del plan.
export class BizError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
const E = {
  RESERVATION_NOT_FOUND: 'La reserva no existe.',
  OTA_RESERVATION_READ_ONLY:
    'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.',
  STATUS_NOT_EDITABLE:
    'El estado actual de la reserva no admite modificaciones.',
  CONCURRENT_UPDATE:
    'Esta reserva ya fue actualizada o cancelada recientemente',
  INVALID_STAY_DATES: 'La fecha de salida debe ser posterior a la de entrada.',
  START_DATE_IN_PAST: 'La fecha de entrada no puede ser anterior a hoy.',
  ROOM_ALREADY_IN_RESERVATION: 'La habitación ya forma parte de la reserva.',
  INVALID_ROOM_COUNT: 'Una reserva debe tener entre 1 y 10 habitaciones.',
  LAST_ROOM_CANNOT_BE_REMOVED:
    'La reserva debe conservar al menos una habitación.',
  INVALID_ROOM_ID: 'El identificador de la habitación no es válido.',
  GUEST_COUNT_TOO_LOW: 'Cada habitación debe tener al menos una persona.',
  GUEST_COUNT_EXCEEDS_CAPACITY:
    'La cantidad de personas supera la capacidad de la habitación.',
  NATIONALITY_NOT_EDITABLE: 'La nacionalidad no se puede modificar.',
  NOTES_TOO_LONG: 'Las observaciones no pueden superar 500 caracteres.',
  INVALID_CHARACTERS: 'El formato de los datos contiene caracteres no válidos.',
  RATE_CHANGED: 'La tarifa cambió, vuelva a cotizar.',
  OTA_RESERVATION_CANCEL_VIA_API:
    'La cancelación de una reserva de OTA debe llegar desde Booking.',
  STATUS_NOT_CANCELLABLE:
    'El estado actual de la reserva no admite cancelación.',
  CANCELLATION_NOT_CONFIRMED:
    'Debe confirmar que entiende que la cancelación no se puede deshacer.',
  REASON_TOO_LONG: 'El motivo no puede superar 500 caracteres.',
  INVALID_RESERVATION_CODE:
    'Debe proveer un código de reserva válido para la consulta.',
} as const;
const fail = (c: keyof typeof E, msg?: string) => new BizError(c, msg ?? E[c]);
const BAD = /[<>{}[\]\\;`]/;
const validDate = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  new Date(s).toISOString().slice(0, 10) === s;
const money = (n: number) => ({ amount: n.toFixed(2), currency: 'COP' });
const nowStamp = () => new Date().toISOString().replace('Z', '000-05:00');
const invRoom = (id: string) => ROOMS.find((x) => x.id === id);

function evaluate(ref: string, b: ModificationBody) {
  const r = RESERVATIONS.find((x) => x.reservationRef === ref);
  if (!r) throw fail('RESERVATION_NOT_FOUND');
  if (r.source !== 'DIRECT') throw fail('OTA_RESERVATION_READ_ONLY');
  if (r.status !== 'ACTIVE') throw fail('STATUS_NOT_EDITABLE');
  if (b.updatedAt !== r.updatedAt) throw fail('CONCURRENT_UPDATE');

  const startDate = b.startDate ?? r.startDate,
    endDate = b.endDate ?? r.endDate;
  if (b.startDate !== undefined || b.endDate !== undefined) {
    if (!validDate(startDate) || !validDate(endDate))
      throw fail('INVALID_STAY_DATES');
    if (startDate < OPERATIONAL_DATE) throw fail('START_DATE_IN_PAST');
    if (endDate <= startDate) throw fail('INVALID_STAY_DATES');
  }
  const current = r.rooms.map((x) => ({
    roomId: x.roomId!,
    guestCount: x.guestCount,
  }));
  const rooms = b.rooms ?? current;
  if (rooms.length === 0) throw fail('LAST_ROOM_CANNOT_BE_REMOVED');
  if (rooms.length > 10) throw fail('INVALID_ROOM_COUNT');
  if (new Set(rooms.map((x) => x.roomId)).size !== rooms.length)
    throw fail('ROOM_ALREADY_IN_RESERVATION');
  rooms.forEach((x) => {
    if (!invRoom(x.roomId)) throw fail('INVALID_ROOM_ID');
  });
  rooms.forEach((x) => {
    if (!Number.isInteger(x.guestCount) || x.guestCount < 1)
      throw fail('GUEST_COUNT_TOO_LOW');
    if (x.guestCount > invRoom(x.roomId)!.maxCapacity)
      throw fail('GUEST_COUNT_EXCEEDS_CAPACITY');
  });
  if (b.guest && 'nationality' in b.guest)
    throw fail('NATIONALITY_NOT_EDITABLE');
  if ((b.notes ?? '').length > 500) throw fail('NOTES_TOO_LONG');
  if (
    BAD.test(b.notes ?? '') ||
    Object.values(b.guest ?? {}).some((v) => BAD.test(String(v ?? '')))
  )
    throw fail('INVALID_CHARACTERS');

  // diffRooms: conservadas, agregadas, quitadas y cambiadas (misma categoría = hereda tarifa; otra = se cotiza)
  const curIds = current.map((x) => x.roomId),
    newIds = rooms.map((x) => x.roomId);
  const removed = curIds.filter((id) => !newIds.includes(id)),
    added = newIds.filter((id) => !curIds.includes(id));
  const cat = (id: string) => invRoom(id)!.categoryRoom;
  const inherit = new Map<string, string>(); // roomId nuevo -> roomId quitado del que hereda
  const remLeft = [...removed],
    addLeft = [...added],
    crossNew: string[] = [];
  for (const rem of [...remLeft]) {
    const i = addLeft.findIndex((a) => cat(a) === cat(rem));
    if (i >= 0) {
      inherit.set(addLeft[i], rem);
      remLeft.splice(remLeft.indexOf(rem), 1);
      addLeft.splice(i, 1);
    }
  }
  while (remLeft.length && addLeft.length) {
    remLeft.shift();
    crossNew.push(addLeft.shift()!);
  }
  const datesChanged = startDate !== r.startDate || endDate !== r.endDate;
  const nights = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;

  const toCheck = datesChanged ? newIds : added;
  const availability = toCheck.map((id) => {
    const inv = invRoom(id)!;
    const busy = RESERVATIONS.some(
      (x) =>
        x.reservationRef !== ref &&
        ['ACTIVE', 'PENDING', 'IN_PROGRESS'].includes(x.status) &&
        x.startDate < endDate &&
        x.endDate > startDate &&
        x.rooms.some((y) => y.roomNumber === inv.roomNumber),
    );
    const m = MAINTENANCE[inv.roomNumber];
    const maint =
      !!m && m.maintenanceStart < endDate && m.maintenanceEnd > startDate;
    return {
      roomId: id,
      roomNumber: inv.roomNumber,
      available: !busy && !maint,
      reason: busy ? 'RESERVED' : maint ? 'MAINTENANCE' : null,
    };
  });
  const bad = availability.find((a) => !a.available);
  if (bad)
    throw fail(
      'NO_AVAILABILITY' as never,
      `La habitación ${bad.roomNumber} no está disponible en las fechas solicitadas: ${bad.reason === 'RESERVED' ? 'ya está reservada' : 'tiene mantenimiento'}.`,
    );

  const quoteIds = datesChanged ? newIds : [...crossNew, ...addLeft];
  const quoted = new Map(
    quoteIds.map((id) => [id, money(RATES[cat(id)] * nights)]),
  );
  const amountOf = (id: string) =>
    quoted.get(id) ??
    r.rooms.find((x) => x.roomId === (inherit.get(id) ?? id))
      ?.roomGrossAmount ??
    money(0);
  const total = money(
    newIds.reduce((s, id) => s + Number(amountOf(id).amount), 0),
  );

  const same = (a: string | null | undefined, c: string | null | undefined) =>
    (a ?? '') === (c ?? '');
  const preview: ModificationPreview = {
    reservationRef: ref,
    changes: {
      dates: datesChanged,
      roomsAdded: addLeft,
      roomsRemoved: remLeft,
      roomsSwapped: [...inherit.keys(), ...crossNew],
      guestCountChanged: rooms.some(
        (x) =>
          x.guestCount !==
          current.find((c) => c.roomId === x.roomId)?.guestCount,
      ),
      guestChanged:
        !!b.guest &&
        Object.entries(b.guest).some(
          ([k, v]) =>
            !same(v as string, (r.guest as Record<string, string | null>)[k]),
        ),
      notesChanged: b.notes !== undefined && b.notes !== r.notes,
    },
    requiresConfirmation: quoteIds.length > 0,
    availability: { rooms: availability },
    quotes: quoteIds.length
      ? {
          rooms: quoteIds.map((id) => ({
            key: id,
            categoryRoom: cat(id),
            nights,
            lodgingAmount: quoted.get(id)!,
          })),
          total,
        }
      : null,
    reservation: {
      startDate,
      endDate,
      guestCount: rooms.reduce((s, x) => s + x.guestCount, 0),
    },
  };
  return { r, rooms, startDate, endDate, nights, preview, amountOf };
}

export const previewModification = (ref: string, b: ModificationBody) =>
  evaluate(ref, b).preview;

export function applyModification(
  ref: string,
  b: ModificationBody,
): ReservationDetail {
  const { r, rooms, startDate, endDate, nights, preview, amountOf } = evaluate(
    ref,
    b,
  );
  if (preview.requiresConfirmation) {
    const stale = preview.quotes!.rooms.some(
      (q) =>
        b.expectedRates?.find((e) => e.roomId === q.key)?.lodgingAmount !==
        q.lodgingAmount.amount,
    );
    if (stale) throw fail('RATE_CHANGED'); // el servidor vuelve a cotizar; nunca guarda un monto del cliente
  }
  const old = new Map(r.rooms.map((x) => [x.roomId, x]));
  r.rooms = rooms.map((x) => ({
    roomId: x.roomId,
    roomNumber: invRoom(x.roomId)!.roomNumber,
    categoryRoom: invRoom(x.roomId)!.categoryRoom,
    guestCount: x.guestCount,
    roomGrossAmount: amountOf(x.roomId),
    stayStatus: old.get(x.roomId)?.stayStatus ?? 'EXPECTED',
  }));
  Object.assign(r, {
    startDate,
    endDate,
    nights,
    guestCount: preview.reservation.guestCount,
    notes: b.notes ?? r.notes,
    updatedAt: nowStamp(),
  });
  if (b.guest)
    Object.assign(
      r.guest,
      Object.fromEntries(
        Object.entries(b.guest).map(([k, v]) => [k, v === '' ? null : v]),
      ),
    );
  return r;
}

export function cancel(ref: string, b: CancelRequest, user: string) {
  if (!/^RSV-[0-9A-F]{8}$/i.test(ref)) throw fail('INVALID_RESERVATION_CODE');
  const r = RESERVATIONS.find(
    (x) => x.reservationRef.toUpperCase() === ref.toUpperCase(),
  );
  if (!r) throw fail('RESERVATION_NOT_FOUND');
  if (r.source !== 'DIRECT') throw fail('OTA_RESERVATION_CANCEL_VIA_API');
  if (b.acknowledged !== true) throw fail('CANCELLATION_NOT_CONFIRMED');
  if (b.updatedAt !== r.updatedAt) throw fail('CONCURRENT_UPDATE'); // antes del estado: la 2.ª cancelación simultánea recibe este mensaje
  if (!['ACTIVE', 'PENDING'].includes(r.status))
    throw fail('STATUS_NOT_CANCELLABLE');
  if ((b.reason ?? '').length > 500) throw fail('REASON_TOO_LONG');
  if (BAD.test(b.reason ?? '')) throw fail('INVALID_CHARACTERS');
  const cancellation = {
    cancellationDate: nowStamp(),
    channel: 'RECEPTION' as const,
    reason: b.reason?.trim() || null,
    processedBy: user || 'recepcion',
  };
  r.status = 'CANCELLED';
  r.cancellation = cancellation;
  r.updatedAt = nowStamp();
  return {
    reservationRef: r.reservationRef,
    status: 'CANCELLED' as const,
    cancellation: {
      cancellationId: crypto.randomUUID(),
      ...cancellation,
      status: 'COMPLETED' as const,
    },
  };
}
