/** Un mantenimiento que se cruza con el rango consultado, con sus dos fechas incluidas. */
export type MaintenancePeriod = {
  maintenanceStart: string;
  maintenanceEnd: string;
};

/**
 * Respuesta del Módulo 1 a la consulta de mantenimientos de una habitación en un rango de fechas
 * (contrato en `consult-maintenance-calendar`, A1). El Módulo 1 decide si hay cruce (`available`). Es un
 * objeto de integración: no se guarda (plan base, "Datos externos").
 */
export type MaintenanceCalendar = {
  roomId: string;
  available: boolean;
  /** Vacía si `available`; no trae el motivo del mantenimiento. */
  conflicts: MaintenancePeriod[];
};
