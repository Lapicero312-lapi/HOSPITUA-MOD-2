import { Inject, Injectable } from '@nestjs/common';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
  type SireMovement,
} from '../process-guest-data/ports/in/select-foreign-movements.port.js';
import { NO_MIGRATORY_MOVEMENTS } from './error-codes.js';
import {
  SIRE_MOVEMENTS_PAGE_SIZE,
  type ListSireMovements,
  type SireMovementItem,
  type SireMovementPage,
  type SireMovementsQuery,
} from './ports/in/list-sire-movements.port.js';

/**
 * `ListSireMovements` (plan de `export-sire-file`, contrato B y D3): la misma selección del archivo
 * (`SelectForeignMovements.byPeriod`), así que la lista muestra lo que saldría al exportar, en el mismo
 * orden. Arma la página con lo que devuelve la selección y no registra nada.
 */
@Injectable()
export class ListSireMovementsService implements ListSireMovements {
  constructor(
    @Inject(SELECT_FOREIGN_MOVEMENTS)
    private readonly selection: SelectForeignMovements,
  ) {}

  async execute(query: SireMovementsQuery): Promise<SireMovementPage> {
    const movements = await this.selection.byPeriod(
      query.startDate,
      query.endDate,
    );
    if (movements.length === 0) {
      // Listar un periodo sin extranjeros no es un error; solo exportarlo lo es (punto 3).
      return {
        items: [],
        page: 1,
        pageSize: SIRE_MOVEMENTS_PAGE_SIZE,
        totalItems: 0,
        totalPages: 0,
        message: NO_MIGRATORY_MOVEMENTS.message,
      };
    }
    const totalPages = Math.ceil(movements.length / SIRE_MOVEMENTS_PAGE_SIZE);
    // Una página que no existe se ajusta a la última válida, como en los demás listados del módulo.
    const page = Math.min(query.page, totalPages);
    const start = (page - 1) * SIRE_MOVEMENTS_PAGE_SIZE;
    return {
      items: movements
        .slice(start, start + SIRE_MOVEMENTS_PAGE_SIZE)
        .map(toItem),
      page,
      pageSize: SIRE_MOVEMENTS_PAGE_SIZE,
      totalItems: movements.length,
      totalPages,
      message: null,
    };
  }
}

/** El elemento de B: los datos del huésped tal como se guardaron, sin el formato del archivo. */
function toItem(movement: SireMovement): SireMovementItem {
  const { guest } = movement;
  return {
    movementId: movement.movementId,
    reservationRef: movement.reservationRef,
    guest: {
      fullName: `${guest.firstName} ${guest.lastName}`,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      nationality: guest.nationality,
    },
    movementType: movement.movementType,
    movementDate: movement.movementDate,
  };
}
