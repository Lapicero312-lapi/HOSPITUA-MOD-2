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

/**
 * Un mantenimiento que se cruza con la estadía, con el periodo del cruce (contrato en
 * `consult-maintenance-calendar`, B). Es un objeto de integración: no se guarda.
 */
export type MaintenanceConflict = {
  /** `AAAA-MM-DD`, tal como lo informa el Módulo 1. */
  maintenanceStart: string;
  /** `AAAA-MM-DD`. */
  maintenanceEnd: string;
  /** Primer día de la estadía afectado. */
  overlapStart: string;
  /** Último día de la estadía afectado. */
  overlapEnd: string;
};

/**
 * Resultado de validar una habitación para una estadía (contrato en `consult-maintenance-calendar`, B).
 * Es un objeto de integración: no se guarda.
 */
export type MaintenanceCheck = {
  roomId: string;
  /** `false` si hay al menos un cruce. */
  available: boolean;
  /** Vacía si `available`. */
  conflicts: MaintenanceConflict[];
};
