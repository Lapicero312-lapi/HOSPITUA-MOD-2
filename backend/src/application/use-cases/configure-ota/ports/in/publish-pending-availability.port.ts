/** Símbolo con el que Nest inyecta el servicio en `ChannexSyncJob` (plan base, regla 4). */
export const PUBLISH_PENDING_AVAILABILITY = Symbol(
  'PUBLISH_PENDING_AVAILABILITY',
);

/** Lo que pasó con las marcas pendientes en un ciclo (plan de `configure-ota`, B3). */
export type PendingAvailabilityResult =
  /** Channex aceptó el envío: las categorías enviadas y las marcas borradas (también las que no se envían). */
  | { status: 'SENT'; categories: string[]; marks: number }
  | { status: 'NOTHING_PENDING' }
  /** Channex no lo aceptó, o el Módulo 1 no respondió y no quedó nada que enviar: el motivo. */
  | { status: 'NOT_SENT'; reason: string };

/**
 * B3 de `configure-ota` (T010): envía a Channex, en una sola solicitud A4, la disponibilidad de las noches
 * que anotaron los cambios de las reservas (`ari_pending_change`), y borra las marcas enviadas.
 */
export interface PublishPendingAvailability {
  publish(): Promise<PendingAvailabilityResult>;
}
