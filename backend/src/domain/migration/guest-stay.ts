import type { DocumentType } from '../shared/enums.js';
import type { GuestData } from './guest-data.js';
import { isForeign } from './is-foreign.js';
import type { MigratoryMovement } from './migratory-movement.js';

/**
 * Una fila de la vista de huéspedes alojados (plan de `process-guest-data`, C1): el huésped en una
 * reserva, con su entrada y su salida. Es derivada y no se guarda.
 */
export type GuestStay = {
  reservationRef: string;
  guest: {
    firstName: string;
    lastName: string;
    documentType: DocumentType;
    documentNumber: string;
    nationality: string;
    isForeign: boolean;
  };
  /** `AAAA-MM-DD`, o `null` si solo tiene salida. */
  entryDate: string | null;
  /** `AAAA-MM-DD`, o `null` si todavía no sale. */
  exitDate: string | null;
  /** `true` con entrada y sin salida: la pantalla muestra "En el hotel". */
  inHotel: boolean;
};

/** La estadía de un huésped a partir de sus movimientos. Solo cuentan los de ese `GuestData`. */
export function deriveGuestStay(
  guest: GuestData,
  movements: readonly MigratoryMovement[],
): GuestStay {
  const dateOf = (movementType: 'ENTRY' | 'DEPARTURE') =>
    movements.find(
      (movement) =>
        movement.guestDataId === guest.id &&
        movement.movementType === movementType,
    )?.movementDate ?? null;
  const entryDate = dateOf('ENTRY');
  const exitDate = dateOf('DEPARTURE');
  return {
    reservationRef: guest.reservationRef,
    guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      nationality: guest.nationality,
      isForeign: isForeign(guest.nationality),
    },
    entryDate,
    exitDate,
    inHotel: entryDate !== null && exitDate === null,
  };
}
