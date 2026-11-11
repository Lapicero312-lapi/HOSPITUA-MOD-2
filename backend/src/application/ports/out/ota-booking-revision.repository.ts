import type { BookingRevisionStatus } from '../../integration/booking-revision.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const OTA_BOOKING_REVISION_REPOSITORY = Symbol(
  'OTA_BOOKING_REVISION_REPOSITORY',
);

/** Qué pasó con la revisión (plan base, `ota_booking_revision.result`). */
export type OtaBookingRevisionResult = 'APPLIED' | 'CONFLICT' | 'IGNORED';

/** Una revisión de Channex ya procesada (plan base, "OtaBookingRevision"). */
export type ProcessedRevision = {
  /** El `id` de la revisión en Channex: la clave de la idempotencia (regla 1). */
  revisionId: string;
  otaId: string;
  /** El mismo para todas las revisiones de una reserva. */
  bookingId: string;
  status: BookingRevisionStatus;
  /** Vacío si la revisión no se aplicó. */
  reservationId: string | null;
  result: OtaBookingRevisionResult;
  processedAt: Date;
  /** Vacío hasta confirmar la revisión a Channex (A2). */
  ackedAt: Date | null;
};

/**
 * Las revisiones de Channex ya procesadas (`generate-ota-reservation`, "`OtaBookingRevisionRepository`
 * (T002)"): evitan procesar una revisión dos veces y guardan si falta su `ack`.
 */
export interface OtaBookingRevisionRepository {
  /** Paso 1 de B1: la revisión si ya se procesó, con su `ackedAt` para repetir el `ack` si faltaba. */
  findById(
    revisionId: string,
    tx?: Transaction,
  ): Promise<ProcessedRevision | null>;

  /**
   * Paso 10 de B1: la registra en la misma transacción que el cambio de la reserva, con
   * `processed_at = now()`.
   * @throws DuplicateOtaBookingRevisionError si otra lectura la registró a la vez: la transacción se
   * revierte y la siguiente lectura la encuentra ya procesada.
   */
  record(
    revision: Omit<ProcessedRevision, 'processedAt' | 'ackedAt'>,
    tx: Transaction,
  ): Promise<void>;

  /**
   * Después del commit, cuando Channex responde 200 al `ack` (A2): `acked_at = now()`. Si ya tenía
   * valor, no lo cambia: se conserva la hora del primer `ack`.
   */
  markAcked(revisionId: string): Promise<void>;

  /** T007: las que quedaron sin `ack`, de la más antigua a la más reciente. */
  findPendingAck(): Promise<ProcessedRevision[]>;

  /**
   * T011b: el `booking_id` de las revisiones de esa reserva (es el mismo en todas), para el reporte del
   * no-show (A3), o `null` si la reserva no tiene ninguna revisión.
   */
  findBookingIdOf(
    reservationId: string,
    tx?: Transaction,
  ): Promise<string | null>;
}

/** La revisión ya está registrada (clave primaria de `ota_booking_revision`). */
export class DuplicateOtaBookingRevisionError extends Error {
  constructor(readonly revisionId: string) {
    super(`La revisión ${revisionId} ya está registrada.`);
  }
}
