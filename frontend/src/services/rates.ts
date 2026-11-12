import { apiRequest } from './api-client.ts';

/** El dinero como texto decimal con dos decimales y su moneda (plan base, "Dinero"): nunca un número. */
export type Money = { amount: string; currency: string };

/**
 * La tarifa de referencia de una categoría (plan de `calculate-dynamic-rate`, C1). Es ilustrativa: no es
 * una cotización ni se usa como la tarifa de una reserva (FR-009).
 */
export type ReferenceRate = {
  categoryRoom: string;
  baseRate: Money;
  /** El ajuste de temporada, el mismo para todas las categorías, con dos decimales (`"15.00"`). */
  seasonAdjustmentPercentage: string;
  /** `baseRate × (1 + seasonAdjustmentPercentage / 100)`, calculada por el backend. */
  effectiveRate: Money;
};

/** La respuesta de `GET /api/rates/reference` (C1). */
export type ReferenceRates = {
  /** Ordenadas por `categoryRoom`. Sin configuración, `[]`. */
  items: ReferenceRate[];
  /** Siempre "Referencia ilustrativa. La tarifa real se obtiene al cotizar." */
  note: string;
};

/**
 * `GET /api/rates/reference` (C1): las tarifas de referencia de cada categoría. El backend las arma con su
 * configuración, sin llamar al Módulo 3.
 * @throws ApiError con el error que respondió el backend.
 */
export function getReferenceRates(
  signal?: AbortSignal,
): Promise<ReferenceRates> {
  return apiRequest<ReferenceRates>('/rates/reference', { signal });
}
