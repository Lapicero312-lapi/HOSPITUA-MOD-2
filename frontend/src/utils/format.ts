import type { ReservationStatus, Source } from '../types';

/** AAAA-MM-DD -> dd/mm/aaaa (sin pasar por Date, para evitar corrimientos de zona horaria). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
/** Solo para mostrar. Los montos llegan como texto decimal y nunca se calculan en el cliente. */
export function formatMoney(
  m: { amount: string; currency: string } | null,
): string {
  if (!m) return '—';
  return `$${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(m.amount))} ${m.currency}`;
}

// Textos del wireframe «Recepcionista (Módulo 2)».
export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activa',
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No se presentó',
};
export const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'ok',
  PENDING: 'warn',
  IN_PROGRESS: 'info',
  COMPLETED: 'neutral',
  CANCELLED: 'err',
  NO_SHOW: 'alt',
};
export const STAY_LABEL: Record<string, string> = {
  EXPECTED: 'Esperada',
  CHECKED_IN: 'Con Check-In',
  CHECKED_OUT: 'Con Check-Out',
  NOT_ARRIVED: 'No llegó',
};
export const MIGRATION: Record<
  string,
  { cls: string; txt: string; tip: string }
> = {
  AWAITING_CHECK_IN: {
    cls: 'warn',
    txt: 'Pendiente de Check-In',
    tip: 'Los datos migratorios de cada huésped se registran en el Check-In',
  },
  COMPLETE: {
    cls: 'ok',
    txt: 'Completo',
    tip: 'Todos los movimientos están registrados y listos para SIRE',
  },
  NOT_REQUIRED: {
    cls: 'neutral',
    txt: 'Sin extranjeros',
    tip: 'No hay huéspedes extranjeros: no entra al reporte SIRE',
  },
  NO_CHECK_IN: {
    cls: 'alt',
    txt: 'Sin Check-In',
    tip: 'La reserva nunca tuvo ingreso: no hay movimientos que reportar',
  },
};
const LOCK_SHORT: Record<string, string> = {
  IN_PROGRESS: 'Hospedaje en curso: no admite cambios ni cancelación',
  COMPLETED: 'Estadía finalizada: solo consulta',
  CANCELLED: 'Reserva cancelada: solo consulta',
  NO_SHOW: 'No se presentó: solo consulta',
};
export const LOCK_LONG: Record<string, string> = {
  IN_PROGRESS:
    '🔒 Hospedaje en curso: la reserva no admite cambios de estadía ni cancelación.',
  COMPLETED: '🔒 Estadía finalizada. Reserva de solo consulta.',
  CANCELLED: '🔒 Reserva cancelada. Solo consulta.',
  NO_SHOW:
    '🔒 Reserva marcada como no presentada por el cierre del día. Solo consulta.',
};
/** Misma regla del plan (FR-005): solo las directas ACTIVE o PENDING se modifican o cancelan. */
export const canChange = (status: ReservationStatus, source: Source) =>
  source === 'DIRECT' && (status === 'ACTIVE' || status === 'PENDING');
export const changeBlockReason = (
  status: ReservationStatus,
  otaName: string | null,
) =>
  LOCK_SHORT[status] ??
  `Reserva de ${otaName ?? 'la agencia'}: solo la agencia la modifica o cancela por su API`;

const CATEGORY_LABEL: Record<string, string> = {
  ESTANDAR: 'Estándar',
  SUPERIOR: 'Superior',
  SUITE: 'Suite',
  DOBLE: 'Doble',
  SUITE_JUNIOR: 'Suite junior',
};
/** `categoryRoom` llega como código (plan de consult-room-inventory); aquí se muestra legible. */
export const categoryLabel = (c: string) =>
  CATEGORY_LABEL[c] ??
  c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ');
export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
