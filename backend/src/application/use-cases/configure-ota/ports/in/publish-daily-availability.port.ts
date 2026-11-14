/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const PUBLISH_DAILY_AVAILABILITY = Symbol('PUBLISH_DAILY_AVAILABILITY');

/**
 * Cómo terminó el envío de la disponibilidad completa (plan de `configure-ota`, B4):
 * - `SENT`: Channex aceptó la disponibilidad de `categories`;
 * - `NOTHING_TO_SEND`: ninguna categoría tiene tipo en Channex;
 * - `NOT_SENT`: Channex no lo aceptó, o el Módulo 1 no respondió para ninguna categoría.
 */
export type DailyAvailabilityResult =
  | { status: 'SENT'; categories: string[] }
  | { status: 'NOTHING_TO_SEND' }
  | { status: 'NOT_SENT'; reason: string };

/**
 * B4 de `configure-ota` (T011): la disponibilidad de hoy a `hoy + CHANNEX_ARI_DAYS` de todas las categorías
 * con tipo en Channex, en un solo A4. Lo que no se puede enviar queda como marcas (B2) para el ciclo de 30 s.
 * Lo llama `AriDailyJob` a las 03:00.
 */
export interface PublishDailyAvailability {
  publish(): Promise<DailyAvailabilityResult>;

  /** Anota las noches de todas las categorías relacionadas como marcas (B2), sin calcular ni enviar. */
  markAllPending(): Promise<void>;
}
