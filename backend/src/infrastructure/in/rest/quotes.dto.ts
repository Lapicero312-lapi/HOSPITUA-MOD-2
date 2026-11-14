import { ApiProperty } from '@nestjs/swagger';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../application/integration/room-quote.js';
import { reservationTotal } from '../../../domain/reservation/reservation-total.js';
import type { Money } from '../../../domain/shared/money.js';
import { MoneyDto as MoneySchema } from './money.dto.js';

/** Un importe en el DTO: texto con dos decimales y su moneda (`calculate-dynamic-rate`, B). */
export type MoneyDto = { amount: string; currency: string };

/*
 * Los DTO son clases, y no tipos, para que OpenAPI los describa (plan base, "Contratos REST"). El dinero usa
 * la clase de `money.dto.ts`, que tiene la misma forma que `MoneyDto`.
 */

/** La tarifa de una noche. */
export class NightlyRateDto {
  @ApiProperty({ format: 'date', example: '2026-10-12' })
  date: string;

  @ApiProperty({ type: MoneySchema })
  rate: MoneyDto;
}

/** Una habitación cotizada en el DTO compartido de la vista previa. */
export class RoomQuoteDto {
  @ApiProperty({
    description:
      'Identifica la habitación en la solicitud: su posición en la reserva directa.',
    example: '1',
  })
  key: string;

  @ApiProperty({ example: 'DOBLE' })
  categoryRoom: string;

  /** La cantidad de noches cotizadas. */
  @ApiProperty({ description: 'La cantidad de noches cotizadas.', example: 3 })
  nights: number;

  @ApiProperty({ type: [NightlyRateDto] })
  nightlyRates: NightlyRateDto[];

  @ApiProperty({ type: MoneySchema })
  lodgingAmount: MoneyDto;
}

/** El DTO compartido de la vista previa (plan de `calculate-dynamic-rate`, B y punto 11). */
export class QuotesDto {
  @ApiProperty({ type: [RoomQuoteDto] })
  rooms: RoomQuoteDto[];

  /**
   * `toQuotesDto` lo suma solo con `withTotal`; en la vista previa de una modificación lo agrega
   * `update-reservation`. Las dos respuestas que usan este DTO lo traen siempre, así que OpenAPI lo marca
   * obligatorio.
   */
  @ApiProperty({
    type: MoneySchema,
    description:
      'La suma de las habitaciones; no se guarda. El `quoteId` no sale hacia la pantalla.',
  })
  total?: MoneyDto;
}

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
