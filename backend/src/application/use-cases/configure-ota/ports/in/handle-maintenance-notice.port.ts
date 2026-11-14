/** Símbolo con el que Nest inyecta el servicio en el consumidor de la cola (plan base, regla 4). */
export const HANDLE_MAINTENANCE_NOTICE = Symbol('HANDLE_MAINTENANCE_NOTICE');

/** Lo que pasó con el mantenimiento en el Módulo 1 (plan de `configure-ota`, E1). */
export type MaintenanceAction = 'SCHEDULED' | 'UPDATED' | 'CANCELLED';

/** El aviso E1 de `m2.habitacion.mantenimiento.queue`, ya revisado por el consumidor. */
export type MaintenanceNotice = {
  messageId: string;
  sequenceNumber: number;
  /** La cola de la que llegó, para `processed_message`. */
  queue: string;
  action: MaintenanceAction;
  roomId: string;
  categoryRoom: string;
  /** `AAAA-MM-DD`, las dos incluidas: la habitación no se vende ninguna de esas noches. */
  startDate: string;
  endDate: string;
  /** Solo con `UPDATED`: las fechas anteriores del mantenimiento, también incluidas. */
  previous: { startDate: string; endDate: string } | null;
};

/** Lo que hizo con el aviso. */
export type MaintenanceNoticeOutcome = 'APPLIED' | 'DUPLICATE';

/**
 * E1 de `configure-ota` (T012b): anota la categoría en las fechas del mantenimiento y, con `UPDATED`,
 * también en las anteriores, recortadas a hoy y a los próximos días de `CHANNEX_ARI_DAYS`, para que el
 * envío de disponibilidad las recalcule. No guarda el mantenimiento: al calcular, se consulta al Módulo 1.
 */
export interface HandleMaintenanceNotice {
  /**
   * En una transacción: un `messageId` ya atendido se confirma sin efectos; uno nuevo deja sus marcas
   * (`AriChangeRecorder`) y su fila en `processed_message`.
   */
  execute(notice: MaintenanceNotice): Promise<MaintenanceNoticeOutcome>;
}
