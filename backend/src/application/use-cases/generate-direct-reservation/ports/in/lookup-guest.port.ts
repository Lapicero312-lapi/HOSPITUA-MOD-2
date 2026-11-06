import type { Guest } from '../../../../../domain/guest/guest.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de la precarga. */
export const LOOKUP_GUEST = Symbol('LOOKUP_GUEST');

/** La precarga del titular en la pantalla "Nueva reserva directa" (plan, E; FR-011). Solo lectura. */
export interface LookupGuest {
  /**
   * El titular de la reserva más reciente con ese tipo y número de documento; `null` si no hay ninguna,
   * que no es un error. Los parámetros llegan tal como vienen en la consulta.
   * @throws BusinessError `GUEST_DATA_REQUIRED`, `INVALID_DOCUMENT_TYPE` o `INVALID_CHARACTERS` (plan,
   * punto 9), sin consultar la base de datos.
   */
  execute(
    documentType: unknown,
    documentNumber: unknown,
  ): Promise<Guest | null>;
}
