/** Símbolo con el que Nest inyecta el servicio. */
export const SYNC_ROOM_TYPES = Symbol('SYNC_ROOM_TYPES');

/**
 * Cómo terminó una sincronización de tipos de habitación (plan de `configure-ota`, C1, "Cómo se arma (T007)").
 * - `SYNCED`: se revisaron todas las categorías. `created` son las que estrenaron un tipo en Channex (A2), en
 *   orden alfabético: necesitan su disponibilidad completa. Una categoría que Channex rechazó con un `4xx` se
 *   registró en el log y no cuenta.
 * - `NOT_SYNCED`: el Módulo 1 o Channex no respondieron, o Channex rechazó la clave. Lo que se confirmó antes de
 *   detenerse quedó guardado; lo demás se intenta en la siguiente sincronización.
 */
export type RoomTypeSync =
  | { status: 'SYNCED'; created: string[] }
  | { status: 'NOT_SYNCED'; reason: string };

/**
 * C1 de `configure-ota` (T007): un tipo de habitación en Channex por cada categoría vendible del Módulo 1, con su
 * cantidad y su mayor capacidad, y su relación en `ota_room_type_mapping`. La llama `EnsureChannexSetup` al
 * iniciar (B1, paso 3); después la usarán el envío de las 03:00 (T011) y el aviso E2 (T012b).
 */
export interface SyncRoomTypes {
  /** Nunca lanza un error de Channex ni del Módulo 1: los devuelve como `NOT_SYNCED`. */
  sync(): Promise<RoomTypeSync>;
}
