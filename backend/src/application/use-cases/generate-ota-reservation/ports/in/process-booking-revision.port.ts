import type { BookingRevision } from '../../../../integration/booking-revision.js';

/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const PROCESS_BOOKING_REVISION = Symbol('PROCESS_BOOKING_REVISION');

/** Qué hacer con la revisión después de procesarla (punto 9 del plan de `generate-ota-reservation`). */
export type RevisionOutcome =
  /** Aplicada, en conflicto o ignorada: se confirma a Channex (A2). */
  | { kind: 'ACKNOWLEDGE' }
  /** No se guardó: queda en el feed, sin `ack`, y se vuelve a leer en el ciclo siguiente. */
  | { kind: 'RETRY'; reason: string };

/**
 * Procesa una revisión de reserva del feed de Channex (plan, B1, B3 y punto 9; T006, T010 y T011c): crea la
 * reserva de una `new`, cancela la de una `cancelled` y, hasta `ApplyOtaChange` (T009), deja en el feed las
 * `modified` de reservas que ya existen.
 */
export interface ProcessBookingRevision {
  /**
   * @returns `ACKNOWLEDGE` o `RETRY` con el motivo, sin datos personales.
   * @throws un error inesperado (por ejemplo, de la base de datos) tal cual.
   */
  process(revision: BookingRevision): Promise<RevisionOutcome>;
}
