import type { ChannexVerification } from './verify-channex-property.port.js';

/** Símbolo con el que Nest inyecta el servicio. */
export const ENSURE_CHANNEX_SETUP = Symbol('ENSURE_CHANNEX_SETUP');

/** La agencia de Booking.com que se registra al iniciar (`configure-ota`, B1, paso 2). */
export const BOOKING_OTA_NAME = 'Booking.com';

/**
 * Configuración de Channex al iniciar (`configure-ota`, B1). La llama `ChannexSetupJob` al arrancar y la
 * repite mientras devuelva `RETRY`.
 */
export interface EnsureChannexSetup {
  /**
   * Paso 1: verifica la propiedad. Pasos 2 y 3, solo si da `READY`: registra la agencia Booking.com sin
   * duplicarla y sincroniza los tipos de habitación (`SyncRoomTypes`, T007). Una sincronización que no se
   * completa no cambia el resultado.
   */
  ensure(): Promise<ChannexVerification>;
}
