import {
  projectReservation,
  type ReservationProjection,
} from '../../../domain/reservation/reservation-projection.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { colombiaTimeWithMicroseconds } from './message-time.js';

/**
 * El detalle de FR-014 tal como viaja al Módulo 1, en la lista del día (T023) y en sus `ADDED` y `UPDATED`
 * (T028): la proyección del dominio con `updatedAt` en hora de Colombia y con sus seis decimales (plan,
 * "Horas del `payload`"). `otaName` es el nombre de la agencia en las reservas `OTA`.
 */
export function messageProjection(
  reservation: Reservation,
  otaName: string | null,
): ReservationProjection {
  const projection = projectReservation(reservation, otaName);
  return {
    ...projection,
    updatedAt: colombiaTimeWithMicroseconds(projection.updatedAt),
  };
}
