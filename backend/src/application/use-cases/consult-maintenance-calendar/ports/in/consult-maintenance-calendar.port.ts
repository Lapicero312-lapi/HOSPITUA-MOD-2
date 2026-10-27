import type { MaintenanceCheck } from '../../../../integration/maintenance-calendar.js';

/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const CONSULT_MAINTENANCE_CALENDAR = Symbol(
  'CONSULT_MAINTENANCE_CALENDAR',
);

/**
 * Consulta de solo lectura al calendario de mantenimientos del Módulo 1 (plan, B). La usa "Verificar
 * disponibilidades" por cada habitación candidata.
 */
export interface ConsultMaintenanceCalendar {
  /**
   * B1: los mantenimientos que se cruzan con la estadía, con el periodo de cada cruce. El Módulo 1
   * decide si hay cruce.
   * @throws BusinessError `INVALID_ROOM_ID` (formato inválido, o el Módulo 1 no reconoce o rechaza la
   * habitación), `INVALID_STAY_DATES` (sin llamar al Módulo 1) o `MAINTENANCE_CHECK_UNAVAILABLE` (el
   * Módulo 1 no responde, falla o responde algo mal formado o incoherente).
   */
  check(
    roomId: string,
    startDate: string,
    endDate: string,
  ): Promise<MaintenanceCheck>;
}
