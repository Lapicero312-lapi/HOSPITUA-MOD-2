import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const OTA_NO_SHOW_REPORT_REPOSITORY = Symbol(
  'OTA_NO_SHOW_REPORT_REPOSITORY',
);

/** Un no-show de Booking que todavía no se reportó a Channex (plan base, `ota_no_show_report`). */
export type PendingNoShow = {
  reservationId: string;
  /** El `booking_id` de Channex, para A3. */
  bookingId: string;
  /** Los envíos que ya se intentaron. */
  attempts: number;
  createdAt: Date;
};

/**
 * Los reportes de no-show a Channex (`generate-ota-reservation`, punto 8; T011b), sobre la tabla
 * `ota_no_show_report`. Los que cambian un reporte suman un intento y solo tocan uno que sigue `PENDING`.
 */
export interface OtaNoShowReportRepository {
  /**
   * Lo deja `PENDING`, con `attempts = 0`, en la transacción del cierre del día. Si la reserva ya tiene su
   * reporte, no hace nada.
   */
  insertPending(
    tx: Transaction,
    reservationId: string,
    bookingId: string,
  ): Promise<void>;

  /** Los `PENDING`, del más antiguo al más reciente (índice parcial de `created_at`). */
  findPending(): Promise<PendingNoShow[]>;

  /** Channex respondió `200`: `REPORTED`, con `reported_at = at`. */
  markReported(reservationId: string, at: Date): Promise<void>;

  /** Channex respondió `404` o `422`: `REJECTED`, sin volver a intentarlo. */
  markRejected(reservationId: string): Promise<void>;

  /** Un envío que no terminó: sigue `PENDING` y se reintenta en el ciclo siguiente. */
  countAttempt(reservationId: string): Promise<void>;
}
