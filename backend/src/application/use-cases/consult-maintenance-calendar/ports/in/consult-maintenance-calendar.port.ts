import type {
  MaintenanceCheck,
  MaintenanceConflict,
} from '../../../../integration/maintenance-calendar.js';

/** Símbolo con el que Nest inyecta el servicio en los demás casos de uso. */
export const CONSULT_MAINTENANCE_CALENDAR = Symbol(
  'CONSULT_MAINTENANCE_CALENDAR',
);

/**
 * Consulta de solo lectura al calendario de mantenimientos del Módulo 1 (plan, B). La usa "Verificar
 * disponibilidades" por cada habitación candidata, y la pantalla "Habitaciones" para el mantenimiento
 * próximo de cada habitación.
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

  /**
   * B2: el mantenimiento más cercano dentro de la ventana, es decir, el cruce de menor
   * `maintenanceStart`, o `null` si no hay. Es una consulta `check` con la ventana: `toDate` cuenta como
   * la salida, así que la ventana va de `fromDate` al día anterior a `toDate`.
   * @throws BusinessError Los mismos que `check`.
   */
  nextMaintenance(
    roomId: string,
    fromDate: string,
    toDate: string,
  ): Promise<MaintenanceConflict | null>;
}
