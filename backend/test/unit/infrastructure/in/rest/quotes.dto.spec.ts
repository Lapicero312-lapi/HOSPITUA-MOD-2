import { describe, expect, it } from 'vitest';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../../../src/application/integration/room-quote.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { toQuotesDto } from '../../../../../src/infrastructure/in/rest/quotes.dto.js';

const cop = (amount: string) => Money.of(amount, 'COP');

/** La cotización del ejemplo del DTO del plan (B): `r1`, `DOBLE`, dos noches. */
const QUOTE_R1: RoomQuote = {
  key: 'r1',
  quoteId: 'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
  currency: 'COP',
  nightlyRates: [
    { date: '2026-10-10', rate: cop('250000') },
    { date: '2026-10-11', rate: cop('280000') },
  ],
  lodgingAmount: cop('530000'),
};
const REQUEST_R1: RoomQuoteRequest = {
  key: 'r1',
  categoryRoom: 'DOBLE',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
};

describe('toQuotesDto (DTO compartido de la vista previa, T010)', () => {
  it('convierte la cotización del ejemplo del plan en el JSON de B, con el total', () => {
    expect(toQuotesDto([QUOTE_R1], [REQUEST_R1], true)).toStrictEqual({
      rooms: [
        {
          key: 'r1',
          categoryRoom: 'DOBLE',
          nights: 2,
          nightlyRates: [
            {
              date: '2026-10-10',
              rate: { amount: '250000.00', currency: 'COP' },
            },
            {
              date: '2026-10-11',
              rate: { amount: '280000.00', currency: 'COP' },
            },
          ],
          lodgingAmount: { amount: '530000.00', currency: 'COP' },
        },
      ],
      total: { amount: '530000.00', currency: 'COP' },
    });
  });

  it('el quoteId no sale hacia la pantalla', () => {
    expect(
      JSON.stringify(toQuotesDto([QUOTE_R1], [REQUEST_R1], true)),
    ).not.toContain(QUOTE_R1.quoteId);
  });

  it('sin withTotal, como en una modificación, no lleva total', () => {
    const dto = toQuotesDto([QUOTE_R1], [REQUEST_R1], false);

    expect('total' in dto).toBe(false);
    expect(dto.rooms).toHaveLength(1);
  });

  it('el total es la suma de las habitaciones', () => {
    const r2: RoomQuote = {
      ...QUOTE_R1,
      key: 'r2',
      nightlyRates: [{ date: '2026-10-10', rate: cop('480000') }],
      lodgingAmount: cop('480000'),
    };

    const dto = toQuotesDto(
      [QUOTE_R1, r2],
      [REQUEST_R1, { ...REQUEST_R1, key: 'r2', categoryRoom: 'SUITE_JUNIOR' }],
      true,
    );

    expect(dto.total).toEqual({ amount: '1010000.00', currency: 'COP' });
    expect(
      dto.rooms.map(({ categoryRoom, nights }) => [categoryRoom, nights]),
    ).toEqual([
      ['DOBLE', 2],
      ['SUITE_JUNIOR', 1],
    ]);
  });

  it('la categoría de cada habitación sale de su solicitud, con la misma key', () => {
    const dto = toQuotesDto(
      [QUOTE_R1],
      [{ ...REQUEST_R1, key: 'otra', categoryRoom: 'TRIPLE' }, REQUEST_R1],
      false,
    );

    expect(dto.rooms[0]?.categoryRoom).toBe('DOBLE');
  });

  it('con monedas distintas, el total da CURRENCY_MISMATCH', () => {
    const usd: RoomQuote = {
      ...QUOTE_R1,
      key: 'r2',
      currency: 'USD',
      lodgingAmount: Money.of('200', 'USD'),
    };

    expect(() =>
      toQuotesDto(
        [QUOTE_R1, usd],
        [REQUEST_R1, { ...REQUEST_R1, key: 'r2' }],
        true,
      ),
    ).toThrow(BusinessError);
  });

  it('una cotización sin su solicitud es un error del programa', () => {
    expect(() => toQuotesDto([QUOTE_R1], [], false)).toThrow(Error);
  });
});
