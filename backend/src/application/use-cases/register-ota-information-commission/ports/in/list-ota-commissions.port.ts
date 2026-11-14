import type {
  OtaCommissionFilters,
  OtaCommissionRow,
} from '../../../../ports/out/reservation-query.port.js';

export type { OtaCommissionFilters, OtaCommissionRow };

/** Símbolo con el que Nest inyecta el caso de uso (plan base, regla 4). */
export const LIST_OTA_COMMISSIONS = Symbol('LIST_OTA_COMMISSIONS');

/** La respuesta de A1, por páginas de 100. */
export type OtaCommissionPage = {
  items: OtaCommissionRow[];
  /** La página que se devolvió: la última válida si la pedida pasaba de la última. */
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

/**
 * Las comisiones de las reservas OTA de un periodo, para el Módulo 3 (plan de
 * `register-ota-information-commission`, A1 y punto C1; T011). Solo lee.
 */
export interface ListOtaCommissions {
  execute(
    filters: OtaCommissionFilters,
    page: number,
  ): Promise<OtaCommissionPage>;
}
