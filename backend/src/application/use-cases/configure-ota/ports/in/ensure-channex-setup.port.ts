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
   * Paso 1: verifica la propiedad. Paso 2, solo si da `READY`: registra la agencia Booking.com sin
   * duplicarla. El paso 3 (los tipos de habitación) lo conecta T007.
   */
  ensure(): Promise<ChannexVerification>;
}
