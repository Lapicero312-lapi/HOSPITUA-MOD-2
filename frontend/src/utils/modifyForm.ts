import type { ModificationBody, ReservationDetail } from '../types';

export interface ModifyValues {
  startDate: string; endDate: string; rooms: { roomId: string; guestCount: number }[];
  guest: { firstName: string; lastName: string; documentType: string; documentNumber: string; contactPhone: string; contactEmail: string };
  notes: string;
}

/** Valores iniciales del formulario a partir del detalle. `roomIdOf` traduce número de habitación a roomId. */
export function initialValues(r: ReservationDetail): ModifyValues {
  return {
    startDate: r.startDate, endDate: r.endDate,
    rooms: r.rooms.map((x) => ({ roomId: x.roomId ?? '', guestCount: x.guestCount })),
    guest: {
      firstName: r.guest.firstName, lastName: r.guest.lastName, documentType: r.guest.documentType ?? 'CC', documentNumber: r.guest.documentNumber ?? '',
      contactPhone: r.guest.contactPhone ?? '', contactEmail: r.guest.contactEmail ?? '',
    },
    notes: r.notes,
  };
}

/** Mismos mensajes literales del plan (orden: fechas, habitaciones, personas, observaciones). null = sin error. */
export function validateModification(v: ModifyValues, today: string, capacityOf: (roomId: string) => number): string | null {
  if (!v.startDate || !v.endDate) return 'La fecha de salida debe ser posterior a la de entrada.';
  if (v.startDate < today) return 'La fecha de entrada no puede ser anterior a hoy.';
  if (v.endDate <= v.startDate) return 'La fecha de salida debe ser posterior a la de entrada.';
  if (v.rooms.length < 1) return 'La reserva debe conservar al menos una habitación.';
  if (v.rooms.length > 10) return 'Una reserva debe tener entre 1 y 10 habitaciones.';
  if (v.rooms.some((x) => !x.roomId)) return 'Elija la habitación de cada fila.';
  if (new Set(v.rooms.map((x) => x.roomId)).size !== v.rooms.length) return 'La habitación ya forma parte de la reserva.';
  if (v.rooms.some((x) => !Number.isInteger(x.guestCount) || x.guestCount < 1)) return 'Cada habitación debe tener al menos una persona.';
  if (v.rooms.some((x) => x.guestCount > capacityOf(x.roomId))) return 'La cantidad de personas supera la capacidad de la habitación.';
  if (v.notes.length > 500) return 'Las observaciones no pueden superar 500 caracteres.';
  return null;
}

/** Solo viaja lo que cambió (el plan: «lo que no se envía queda igual»). Sin `nationality`: no se modifica. */
export function buildBody(r: ReservationDetail, v: ModifyValues): ModificationBody | null {
  const o = initialValues(r);
  const body: ModificationBody = { updatedAt: r.updatedAt ?? '' };
  let changed = false;
  if (v.startDate !== o.startDate || v.endDate !== o.endDate) { body.startDate = v.startDate; body.endDate = v.endDate; changed = true; }
  if (JSON.stringify(v.rooms) !== JSON.stringify(o.rooms)) { body.rooms = v.rooms; changed = true; }
  const g = (Object.keys(v.guest) as (keyof ModifyValues['guest'])[]).filter((k) => v.guest[k].trim() !== o.guest[k]);
  if (g.length) { body.guest = Object.fromEntries(g.map((k) => [k, v.guest[k].trim()])); changed = true; }
  if (v.notes !== o.notes) { body.notes = v.notes; changed = true; }
  return changed ? body : null;
}
