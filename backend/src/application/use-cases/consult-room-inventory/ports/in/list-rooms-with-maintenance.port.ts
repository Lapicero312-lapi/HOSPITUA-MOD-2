import type { Room } from '../../../../integration/room.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de la pantalla "Habitaciones". */
export const LIST_ROOMS_WITH_MAINTENANCE = Symbol(
  'LIST_ROOMS_WITH_MAINTENANCE',
);

/**
 * Símbolo con el que Nest le entrega al servicio el tope de consultas de mantenimiento en paralelo. El
 * valor viene de la configuración validada (`MAINTENANCE_CONCURRENCY`, mínimo 1), así que el servicio no
 * lo vuelve a revisar.
 */
export const MAINTENANCE_CONCURRENCY = Symbol('MAINTENANCE_CONCURRENCY');

/**
 * `SCHEDULED`: tiene un mantenimiento próximo; `NONE`: no tiene; `UNAVAILABLE`: no se pudo consultar su
 * calendario, así que no se asume que no tiene (plan, C1).
 */
export type MaintenanceStatus = 'SCHEDULED' | 'NONE' | 'UNAVAILABLE';

/** Una habitación de la pantalla "Habitaciones" (plan, C1): sus datos del inventario y su mantenimiento próximo. */
export type RoomWithMaintenance = Room & {
  maintenance: {
    status: MaintenanceStatus;
    /** Las fechas del mantenimiento más cercano; `null` si no tiene o si no se pudo consultar. */
    maintenanceStart: string | null;
    maintenanceEnd: string | null;
  };
};

/** La pantalla "Habitaciones" (plan, D3): todas las habitaciones vendibles con su mantenimiento próximo. */
export interface ListRoomsWithMaintenance {
  /**
   * Todas las habitaciones vendibles, ordenadas por categoría y luego por número (plan, C1), cada una con
   * su mantenimiento próximo dentro de los siguientes 30 días contando hoy.
   * @throws BusinessError `INVENTORY_UNAVAILABLE` si falla el inventario: nunca se devuelve una lista
   * incompleta. Si falla solo el calendario de una habitación, esa sale `UNAVAILABLE` y las demás siguen.
   */
  execute(): Promise<RoomWithMaintenance[]>;
}
