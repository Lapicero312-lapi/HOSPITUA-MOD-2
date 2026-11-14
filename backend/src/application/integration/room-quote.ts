import type { Money } from '../../domain/shared/money.js';
import type { NightlyRate } from './rate-quote.js';

/**
 * Solicitud de cotización de una habitación de la reserva (contrato en `calculate-dynamic-rate`, B). Es un
 * objeto de integración: no se guarda.
 */
export type RoomQuoteRequest = {
  /** Identifica la habitación en la reserva; la `RoomQuote` lo devuelve igual. */
  key: string;
  categoryRoom: string;
  startDate: string;
  endDate: string;
};

/**
 * Cotización del Módulo 3 para una habitación de la reserva (contrato en `calculate-dynamic-rate`, B). Es
 * un objeto de integración: no se guarda.
 */
export type RoomQuote = {
  /** El mismo de la solicitud (identifica la habitación en la reserva). */
  key: string;
  quoteId: string;
  /** 3 letras. */
  currency: string;
  nightlyRates: NightlyRate[];
  lodgingAmount: Money;
};
