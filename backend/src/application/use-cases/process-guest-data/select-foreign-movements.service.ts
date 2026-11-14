import { Inject, Injectable } from '@nestjs/common';
import { isForeign } from '../../../domain/migration/is-foreign.js';
import {
  MIGRATORY_MOVEMENT_REPOSITORY,
  type MigratoryMovementRepository,
  type MovementWithGuest,
} from '../../ports/out/migratory-movement.repository.js';
import type {
  SelectForeignMovements,
  SireMovement,
} from './ports/in/select-foreign-movements.port.js';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ENTRY` antes que `DEPARTURE` (plan, B2). */
const MOVEMENT_TYPE_ORDER = { ENTRY: 0, DEPARTURE: 1 } as const;

/**
 * `SelectForeignMovements` (plan, B2 y D2): lee los movimientos con su huésped, deja solo los de
 * extranjeros (`isForeign`: nacionalidad distinta de `Colombia`; una vacía no es extranjera) y los ordena
 * de forma estable para el archivo.
 */
@Injectable()
export class SelectForeignMovementsService implements SelectForeignMovements {
  constructor(
    @Inject(MIGRATORY_MOVEMENT_REPOSITORY)
    private readonly movements: MigratoryMovementRepository,
  ) {}

  async byPeriod(from: string, to: string): Promise<SireMovement[]> {
    const movements = await this.movements.findWithGuestByPeriod(from, to);
    return movements
      .filter((movement) => isForeign(movement.guest.nationality))
      .sort(bySireOrder)
      .map(toSireMovement);
  }

  async byMovementId(movementId: string): Promise<SireMovement | null> {
    // Un id que no es UUID no existe: no se consulta la base.
    if (!UUID_FORMAT.test(movementId)) {
      return null;
    }
    const movement = await this.movements.findWithGuestById(movementId);
    return movement !== null && isForeign(movement.guest.nationality)
      ? toSireMovement(movement)
      : null;
  }
}

/** `movementDate`, `reservationRef`, `documentNumber` y `movementType`; en `AAAA-MM-DD`, el texto ordena las fechas. */
function bySireOrder(a: MovementWithGuest, b: MovementWithGuest): number {
  return (
    compareText(a.movementDate, b.movementDate) ||
    compareText(a.reservationRef, b.reservationRef) ||
    compareText(a.guest.documentNumber, b.guest.documentNumber) ||
    MOVEMENT_TYPE_ORDER[a.movementType] - MOVEMENT_TYPE_ORDER[b.movementType]
  );
}

/** Por código de carácter, sin depender del idioma del computador. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Una copia de los datos tal como se guardaron. */
function toSireMovement(movement: MovementWithGuest): SireMovement {
  return {
    movementId: movement.movementId,
    reservationRef: movement.reservationRef,
    movementType: movement.movementType,
    movementDate: movement.movementDate,
    guest: { ...movement.guest },
  };
}
