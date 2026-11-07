import type { GuestStay } from '../../../../../domain/migration/guest-stay.js';
import type { GuestStayFilters } from '../../guest-stay-filters.validator.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de la vista (plan base, regla 4). */
export const LIST_GUEST_STAYS = Symbol('LIST_GUEST_STAYS');

/** Las filas de una página fija de 10 (FR-012). */
export const GUEST_STAYS_PAGE_SIZE = 10;

/** El mensaje del listado vacío (spec, historia 3, escenario 7). */
export const NO_GUEST_STAYS_MESSAGE =
  'No hay huéspedes que coincidan con los filtros.';

/** Una página de la vista de huéspedes alojados (plan, C1). */
export type GuestStayPage = {
  items: GuestStay[];
  /** La página devuelta: si se pidió una que no existe, la última válida. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** `0` si no hay resultados. */
  totalPages: number;
  /** `NO_GUEST_STAYS_MESSAGE` si no hay resultados; si no, `null`. */
  message: string | null;
};

/** La vista de huéspedes alojados de la Recepcionista (plan de `process-guest-data`, C1). Solo lee. */
export interface ListGuestStays {
  /** Los filtros ya los revisó `readGuestStayFilters`. */
  execute(filters: GuestStayFilters): Promise<GuestStayPage>;
}
