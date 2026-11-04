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

/** Lo que se cotiza de una habitación de la reserva (`calculate-dynamic-rate`, B). */
export type RoomQuoteRequest = {
  /** Identifica la habitación en la reserva; la cotización lo devuelve igual. */
  key: string;
  categoryRoom: string;
  /** `AAAA-MM-DD`. */
  startDate: string;
  /** `AAAA-MM-DD`, posterior a `startDate`: es la salida. */
  endDate: string;
};

/** La cotización de una habitación de la reserva (`calculate-dynamic-rate`, B): un `RateQuote` con su `key`. */
export type RoomQuote = RateQuote & {
  /** El mismo de la solicitud. */
  key: string;
};
