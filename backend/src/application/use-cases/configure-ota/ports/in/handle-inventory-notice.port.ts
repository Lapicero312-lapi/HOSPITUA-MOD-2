/** Símbolo con el que Nest inyecta el servicio en el consumidor de la cola (plan base, regla 4). */
export const HANDLE_INVENTORY_NOTICE = Symbol('HANDLE_INVENTORY_NOTICE');

/** Lo que pasó con la habitación en el Módulo 1 (plan de `configure-ota`, E2). */
export type InventoryAction = 'ADDED' | 'REMOVED' | 'UPDATED';

/** El aviso E2 de `m2.habitacion.inventario.queue`, ya revisado por el consumidor. */
export type InventoryNotice = {
  messageId: string;
  sequenceNumber: number;
  /** La cola de la que llegó, para `processed_message`. */
  queue: string;
  action: InventoryAction;
  roomId: string;
  categoryRoom: string;
  /** Solo si la habitación cambió de categoría: la que tenía antes. */
  previousCategoryRoom: string | null;
};

/** Lo que hizo con el aviso. */
export type InventoryNoticeOutcome = 'APPLIED' | 'DUPLICATE';

/**
 * Otra tarea de Channex tiene el bloqueo asesor: el aviso no se procesó ni se anotó, y se reintenta con la
 * espera creciente de la cola (plan de `configure-ota`, E2, "Bloqueo ocupado").
 */
export class ChannexLockBusyError extends Error {
  constructor() {
    super(
      'Otra tarea de Channex tiene el bloqueo: el aviso de inventario se reintenta.',
    );
    this.name = 'ChannexLockBusyError';
  }
}

/**
 * E2 de `configure-ota` (T012b): con el bloqueo de las tareas de Channex, sincroniza los tipos de habitación
 * (C1) y anota los próximos días de `CHANNEX_ARI_DAYS` de `categoryRoom` y, si viene, de
 * `previousCategoryRoom`, para que el envío de disponibilidad los recalcule.
 */
export interface HandleInventoryNotice {
  /**
   * 1. Un `messageId` ya atendido se confirma sin efectos y sin sincronizar.
   * 2. Con el bloqueo, `SyncRoomTypes`; un `NOT_SYNCED` no detiene el aviso. Si Channex no está listo, no se
   *    sincroniza.
   * 3. En una transacción, las marcas (`AriChangeRecorder`) y la fila en `processed_message`.
   * @throws ChannexLockBusyError si otra tarea de Channex tiene el bloqueo: no se anotó nada.
   */
  execute(notice: InventoryNotice): Promise<InventoryNoticeOutcome>;
}
