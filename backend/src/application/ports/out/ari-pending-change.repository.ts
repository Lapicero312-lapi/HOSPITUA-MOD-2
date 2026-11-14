import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const ARI_PENDING_CHANGE_REPOSITORY = Symbol(
  'ARI_PENDING_CHANGE_REPOSITORY',
);

/**
 * Un cambio de ocupación de una categoría en un rango de noches (`dateFrom` incluido, `dateTo` excluido:
 * el día de salida no se ocupa), en `AAAA-MM-DD` (`configure-ota`, B2).
 */
export type AriChange = {
  categoryRoom: string;
  dateFrom: string;
  dateTo: string;
};

/** Una marca de disponibilidad pendiente de enviar a Channex (plan base, "AriPendingChange"). */
export type AriPendingChange = AriChange & { id: string };

/**
 * Las marcas de disponibilidad pendientes de enviar a Channex (`configure-ota`, B y T002). Las deja
 * `AriChangeRecorder` (B2) y las envía y borra `PublishPendingAvailability` (T010).
 */
export interface AriPendingChangeRepository {
  /**
   * B2: una fila por cambio, en la transacción del cambio de la reserva: si esa transacción se revierte,
   * las marcas no quedan. Sin cambios, no hace nada.
   */
  insert(changes: AriChange[], tx: Transaction): Promise<void>;

  /** T010: todas las marcas pendientes, de la más antigua a la más reciente. */
  findAll(): Promise<AriPendingChange[]>;

  /**
   * T010: después del `200` de A4 borra solo las marcas enviadas; las que llegaron durante el envío se
   * conservan para el siguiente. Sin ids, no hace nada.
   */
  deleteByIds(ids: string[]): Promise<void>;
}
