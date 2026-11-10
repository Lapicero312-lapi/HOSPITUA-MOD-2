import type { CancellationResult } from '../../../application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { colombiaTime } from '../../../application/use-cases/check-view-reservation/message-time.js';

/** El cuerpo de la respuesta 200 de la cancelación (plan de `cancel-reservation`, contrato A). */
export type ReservationCancellationBody = Omit<
  CancellationResult,
  'cancellation'
> & {
  cancellation: Omit<CancellationResult['cancellation'], 'cancellationDate'> & {
    /** En hora de Colombia, con segundos: `2026-10-09T10:15:20-05:00`. */
    cancellationDate: string;
  };
};

/** Escribe la cancelación como la recibe la pantalla: el instante pasa a hora de Colombia. */
export function toReservationCancellationBody(
  result: CancellationResult,
): ReservationCancellationBody {
  return {
    ...result,
    cancellation: {
      ...result.cancellation,
      cancellationDate: colombiaTime(result.cancellation.cancellationDate),
    },
  };
}
