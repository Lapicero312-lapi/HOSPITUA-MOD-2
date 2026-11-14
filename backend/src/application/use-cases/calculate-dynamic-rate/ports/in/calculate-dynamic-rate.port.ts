import type { Money } from '../../../../../domain/shared/money.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../../integration/room-quote.js';

/** Símbolo con el que Nest inyecta el servicio en los flujos de reserva (plan base, regla 4). */
export const CALCULATE_DYNAMIC_RATE = Symbol('CALCULATE_DYNAMIC_RATE');

/**
 * Cuántas cotizaciones al Módulo 3 van a la vez, como mucho. El valor viene de la configuración validada
 * (`QUOTE_CONCURRENCY`, mínimo 1) y lo entrega `Module3ClientModule`.
 */
export const QUOTE_CONCURRENCY = Symbol('QUOTE_CONCURRENCY');

/** Para qué se cotiza: decide el mensaje de error si el Módulo 3 no responde (plan, B). */
export type QuoteContext = 'NEW_RESERVATION' | 'RECALCULATION';

/** La cotización de las habitaciones de una reserva al Módulo 3 (plan, B). */
export interface CalculateDynamicRate {
  /**
   * B1: una cotización por habitación, en paralelo con el tope `QUOTE_CONCURRENCY`, todo o nada: si una
   * falla, fallan todas y no se devuelve ninguna. No consulta al Módulo 1: la disponibilidad ya la
   * verificó el flujo.
   * @throws BusinessError `INVALID_CATEGORY` o `INVALID_STAY_DATES`, antes de llamar al Módulo 3 o si el
   * Módulo 3 los rechaza; `PRICING_UNAVAILABLE` (reserva nueva) o `RECALCULATION_UNAVAILABLE`
   * (recotización) si el Módulo 3 no responde, falla o responde algo inválido.
   */
  quoteRooms(
    requests: RoomQuoteRequest[],
    context: QuoteContext,
  ): Promise<RoomQuote[]>;

  /**
   * B4 (decisión D1): al confirmar, vuelve a cotizar todas las habitaciones de la solicitud y compara,
   * por `key`, el `lodgingAmount` nuevo con el que vio el solicitante: el mismo valor y la misma moneda
   * (plan, punto 10). Devuelve las cotizaciones nuevas, con su `quoteId`: nunca se guarda un monto que
   * envía el cliente.
   * @throws BusinessError `RATE_CHANGED` si alguno difiere o si falta el monto visto de una habitación;
   * los mismos errores que `quoteRooms`.
   */
  verifyQuotes(
    seen: { key: string; lodgingAmount: Money }[],
    requests: RoomQuoteRequest[],
    context: QuoteContext,
  ): Promise<RoomQuote[]>;
}
