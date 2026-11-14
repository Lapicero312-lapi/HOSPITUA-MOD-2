import type { ReferenceRate } from '../../../../../domain/rate/reference-rate.js';

/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const GET_REFERENCE_RATES = Symbol('GET_REFERENCE_RATES');

/**
 * La configuración de la pantalla "Tarifas" (`RATE_REFERENCE`, plan de `calculate-dynamic-rate`, C1 y
 * punto 12), ya validada al arrancar: una tarifa base por categoría y un solo porcentaje de ajuste, todos
 * como texto decimal. La entrega `RateReferenceConfigModule`, que es global; `null` si no está configurada.
 */
export const RATE_REFERENCE = Symbol('RATE_REFERENCE');

export type RateReferenceSettings = {
  seasonAdjustmentPercentage: string;
  /** 3 letras mayúsculas (ISO 4217). */
  currency: string;
  /** La tarifa base de cada categoría, con la forma de `categoryRoom`. */
  baseRates: Readonly<Record<string, string>>;
};

/** Las tarifas de referencia de la pantalla "Tarifas" (C1). No llama al Módulo 3 ni al Módulo 1. */
export interface GetReferenceRates {
  /** Una por categoría de la configuración, ordenadas por `categoryRoom`; vacía si no está configurada. */
  execute(): ReferenceRate[];
}
