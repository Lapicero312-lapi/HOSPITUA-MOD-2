import type { StayRangeReservation } from '../../../../ports/out/reservation-query.port.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de reservas. */
export const FIND_RESERVATIONS_BY_STAY_RANGE = Symbol(
  'FIND_RESERVATIONS_BY_STAY_RANGE',
);

/** La consulta del Módulo 1 ya revisada: las dos fechas (`AAAA-MM-DD`) y, si vino, la habitación. */
export type StayRangeQuery = {
  dateFrom: string;
  dateTo: string;
  roomId: string | null;
};

export type { StayRangeReservation };

/**
 * La consulta de reservas por fechas del Módulo 1 (plan, C5 y "Consulta del Módulo 1"; FR-023). Le sirve
 * para validar un mantenimiento al registrarlo o dar de baja una habitación. Solo lectura.
 */
export interface FindReservationsByStayRange {
  /**
   * Las reservas `PENDING`, `ACTIVE` o `IN_PROGRESS` cuya estadía se cruza con el rango, con todas sus
   * habitaciones, de la llegada más antigua a la más reciente. Sin coincidencias, una lista vacía.
   */
  execute(query: StayRangeQuery): Promise<StayRangeReservation[]>;
}
