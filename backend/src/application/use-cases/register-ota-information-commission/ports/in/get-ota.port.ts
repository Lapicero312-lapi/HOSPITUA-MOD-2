import type { OtaOverview } from '../../../../ports/out/ota.repository.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador. */
export const GET_OTA = Symbol('GET_OTA');

/** Una agencia (plan, A3, `GET /api/otas/{otaId}`), de solo lectura. */
export interface GetOta {
  /**
   * La agencia con su `activeReservations`, con los mismos campos que en `ListOtas`.
   * @throws BusinessError `OTA_NOT_FOUND` si no existe, también si `otaId` no es un UUID.
   */
  execute(otaId: string): Promise<OtaOverview>;
}
