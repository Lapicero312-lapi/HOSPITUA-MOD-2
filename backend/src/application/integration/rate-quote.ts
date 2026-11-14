import type { Money } from '../../domain/shared/money.js';

export type NightlyRate = {
  date: string;
  rate: Money;
};

/**
 * Cotización del Módulo 3 para una habitación (contrato en `calculate-dynamic-rate`, A1). De ella solo se
 * guardan el `lodgingAmount`, el `quoteId` y la moneda en la `ReservationRoom` (D2); las tarifas por
 * noche solo se muestran. Es un objeto de integración (plan base, "Datos externos").
 */
export type RateQuote = {
  quoteId: string;
  currency: string;
  nightlyRates: NightlyRate[];
  /** Mayor que cero. */
  lodgingAmount: Money;
};
