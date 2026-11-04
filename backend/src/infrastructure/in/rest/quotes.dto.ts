import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../application/integration/rate-quote.js';
import { reservationTotal } from '../../../domain/reservation/reservation-total.js';
import type { Money } from '../../../domain/shared/money.js';

/** Un importe en el DTO: texto con dos decimales y su moneda (`calculate-dynamic-rate`, B). */
export type MoneyDto = { amount: string; currency: string };

/** Una habitación cotizada en el DTO compartido de la vista previa. */
export type RoomQuoteDto = {
  key: string;
  categoryRoom: string;
  /** La cantidad de noches cotizadas. */
  nights: number;
  nightlyRates: { date: string; rate: MoneyDto }[];
  lodgingAmount: MoneyDto;
};

/** El DTO compartido de la vista previa (plan de `calculate-dynamic-rate`, B y punto 11). */
export type QuotesDto = {
  rooms: RoomQuoteDto[];
  /** Solo en la vista previa de una reserva nueva. */
  total?: MoneyDto;
};

/**
 * Convierte las cotizaciones en el DTO compartido de la vista previa (plan, B y punto 11). La categoría de
 * cada habitación sale de su solicitud, con la misma `key`. Con `withTotal`, agrega la suma de las
 * habitaciones (`reservationTotal`, que exige una sola moneda). El `quoteId` no sale hacia la pantalla.
 */
export function toQuotesDto(
  quotes: RoomQuote[],
  requests: RoomQuoteRequest[],
  withTotal: boolean,
): QuotesDto {
  const categoryOf = new Map(
    requests.map(({ key, categoryRoom }) => [key, categoryRoom]),
  );
  const rooms = quotes.map((quote): RoomQuoteDto => {
    const categoryRoom = categoryOf.get(quote.key);
    if (categoryRoom === undefined) {
      throw new Error(`La cotización ${quote.key} no tiene su solicitud.`);
    }
    return {
      key: quote.key,
      categoryRoom,
      nights: quote.nightlyRates.length,
      nightlyRates: quote.nightlyRates.map(({ date, rate }) => ({
        date,
        rate: toMoneyDto(rate),
      })),
      lodgingAmount: toMoneyDto(quote.lodgingAmount),
    };
  });
  if (!withTotal) {
    return { rooms };
  }
  const [first, ...rest] = quotes.map(({ lodgingAmount }) => lodgingAmount);
  if (first === undefined) {
    throw new Error('No hay cotizaciones para sumar el total.');
  }
  return { rooms, total: toMoneyDto(reservationTotal([first, ...rest])) };
}

function toMoneyDto(money: Money): MoneyDto {
  return { amount: money.amountWithCents, currency: money.currency };
}
