import type { Reservation } from '../../../../../domain/reservation/reservation.js';
import type { Money } from '../../../../../domain/shared/money.js';
import type { Transaction } from '../../../../ports/out/transaction.js';
import type { CommissionResult } from '../../../register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';

/** Símbolo con el que Nest inyecta el servicio en `generate-ota-reservation` (plan base, regla 4). */
export const APPLY_OTA_CHANGE = Symbol('APPLY_OTA_CHANGE');

/** El cambio que envía Booking en una revisión `modified` (plan de `update-reservation`, C4). */
export type OtaChange = {
  startDate: string;
  endDate: string;
  rooms: { categoryRoom: string; guestCount: number }[];
  grossAmount: Money;
  notes: string | null;
  guest: {
    firstName: string;
    lastName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    nationality: string | null;
  };
};

/** Una habitación del cambio, ya resuelta (punto 15). */
export type PlannedOtaRoom = {
  /** La fila que se conserva, con la misma habitación; `null` si es nueva. */
  keptRoomId: string | null;
  /** `null`: sin asignar. */
  room: { roomId: string; roomNumber: string } | null;
  categoryRoom: string;
  guestCount: number;
};

/** Lo que decidió `prepare`, para que `apply` solo escriba (punto 15). */
export type OtaChangePlan = {
  /** La que leyó `prepare`, con su `updatedAt`. */
  reservation: Reservation;
  change: OtaChange;
  /** Una por cada habitación de `change.rooms`, en su orden. */
  rooms: PlannedOtaRoom[];
  conflictReason: 'NO_ROOM_AVAILABLE' | 'CAPACITY_EXCEEDED' | null;
  /** La comisión con el porcentaje congelado; `null` si el valor no cambió. */
  commission: CommissionResult | null;
};

/**
 * Los cambios que envía Booking a una reserva suya (plan de `update-reservation`, C4 y punto 15; FR-024;
 * T026). Nunca rechaza un cambio por falta de lugar ni por capacidad: deja habitaciones sin asignar y marca
 * el conflicto.
 */
export interface ApplyOtaChange {
  /**
   * Antes de la transacción: consulta la disponibilidad (Módulo 1) y decide qué habitaciones conserva,
   * reasigna o deja sin asignar, el conflicto y la comisión. No escribe nada.
   * @throws Error si la reserva no es de OTA o no está en `ACTIVE` ni `PENDING`: lo decide antes quien llama.
   * @throws BusinessError los de `VerifyAvailability.check` si el Módulo 1 no responde.
   */
  prepare(reservation: Reservation, change: OtaChange): Promise<OtaChangePlan>;

  /**
   * Dentro de la transacción de quien llama: solo escribe. Guarda la reserva cambiada, la auditoría de la
   * comisión si se recalculó, y los avisos a la lista del día y a Channex.
   * @returns La reserva guardada, aplicada o en conflicto.
   * @throws BusinessError `CONCURRENT_UPDATE` si la reserva cambió desde `prepare`; RoomOverlapError si la
   * restricción anti-solape rechaza una habitación. En los dos casos quien llama no confirma la revisión.
   */
  apply(tx: Transaction, plan: OtaChangePlan): Promise<Reservation>;
}
