import type { MovementType } from '../../../../../domain/shared/enums.js';

/** Símbolo con el que Nest inyecta el servicio en `SireController` (plan base, regla 4). */
export const LIST_SIRE_MOVEMENTS = Symbol('LIST_SIRE_MOVEMENTS');

/** Tamaño fijo de una página del listado (plan de `export-sire-file`, contrato B: no hay `pageSize`). */
export const SIRE_MOVEMENTS_PAGE_SIZE = 50;

/**
 * Lo que se pide listar, ya revisado por `readSireMovementsQuery` (plan, contrato B): el periodo
 * (`AAAA-MM-DD`, los dos días incluidos) y la página, desde 1.
 */
export type SireMovementsQuery = {
  startDate: string;
  endDate: string;
  page: number;
};

/** Un elemento del listado: un huésped extranjero y un tipo de movimiento (contrato B). */
export type SireMovementItem = {
  movementId: string;
  reservationRef: string;
  guest: {
    /** Nombres y apellidos tal como se guardaron, separados por un espacio. */
    fullName: string;
    documentType: string;
    documentNumber: string;
    nationality: string;
  };
  movementType: MovementType;
  /** `AAAA-MM-DD`. */
  movementDate: string;
};

/** La respuesta de B. */
export type SireMovementPage = {
  items: SireMovementItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** "No hay movimientos migratorios que reportar en ese periodo." si no hay ninguno; si no, `null`. */
  message: string | null;
};

/** El listado de los movimientos del periodo (plan, contrato B y D3). Solo lee: no registra nada. */
export interface ListSireMovements {
  /**
   * Los movimientos de extranjeros del periodo, de `SIRE_MOVEMENTS_PAGE_SIZE` en `SIRE_MOVEMENTS_PAGE_SIZE`,
   * en el orden del archivo. Un periodo sin extranjeros no es un error: devuelve la página vacía con el
   * mensaje. Una página que no existe se ajusta a la última válida.
   */
  execute(query: SireMovementsQuery): Promise<SireMovementPage>;
}
