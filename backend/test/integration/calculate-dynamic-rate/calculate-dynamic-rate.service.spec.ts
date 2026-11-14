import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { delay, http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { RoomQuoteRequest } from '../../../src/application/integration/room-quote.js';
import { CalculateDynamicRateService } from '../../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.service.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import {
  INVALID_CATEGORY,
  PRICING_UNAVAILABLE,
} from '../../../src/domain/shared/error-codes.js';
import { AppConfigModule } from '../../../src/infrastructure/config/app-config.module.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { Module3ClientModule } from '../../../src/infrastructure/out/module3/module3-client.module.js';

/**
 * Pruebas de integración de `calculate-dynamic-rate` (T012: escenarios 1 y 2 de la historia 1 y el caso
 * borde de la categoría inexistente): el servicio, el adaptador HTTP y la configuración reales, armados
 * con Nest, contra el Módulo 3 simulado (msw). Las pruebas unitarias del servicio usan un `Module3Port`
 * simulado; estas comprueban que las piezas funcionan juntas, con el tiempo de espera real.
 */

/** Las dos habitaciones `DOBLE` del ejemplo de A1 del plan: dos noches, del 10 al 12 de octubre. */
const ROOM_1: RoomQuoteRequest = {
  key: '1',
  categoryRoom: 'DOBLE',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
};
const ROOM_2: RoomQuoteRequest = { ...ROOM_1, key: '2' };

/** La `RateQuote` del ejemplo de A1, con el `quoteId` que se pida. */
const rateQuote = (quoteId: string): JsonBodyType => ({
  quoteId,
  currency: 'COP',
  nightlyRates: [
    { date: '2026-10-10', rate: '250000.00' },
    { date: '2026-10-11', rate: '280000.00' },
  ],
  lodgingAmount: '530000.00',
});

const QUOTE_IDS = [
  'a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b',
  'b2e3d4c5-f6a7-4890-9b0c-1d2e3f4a5b6c',
  'c3f4e5d6-a7b8-4901-8c1d-2e3f4a5b6c7d',
];

const server = setupServer();

/** Los cuerpos de las cotizaciones que recibió el Módulo 3 simulado, en orden de llegada. */
let received: unknown[] = [];

describe('CalculateDynamicRate contra el Módulo 3 simulado', () => {
  let moduleRef: TestingModule;
  let rates: CalculateDynamicRate;
  let quotesUrl: string;
  let timeoutMs: number;

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, Module3ClientModule],
      providers: [
        {
          provide: CALCULATE_DYNAMIC_RATE,
          useClass: CalculateDynamicRateService,
        },
      ],
    }).compile();
    rates = moduleRef.get(CALCULATE_DYNAMIC_RATE);

    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    quotesUrl = `${config.get('MODULE3_BASE_URL', { infer: true })}/pricing/quotes`;
    timeoutMs = config.get('MODULE3_TIMEOUT_MS', { infer: true });
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    received = [];
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await moduleRef.close();
  });

  /** El Módulo 3 simulado responde, en orden, lo que dé `respond` a cada cotización. */
  function module3Responds(
    respond: (call: number) => Response | Promise<Response>,
  ): void {
    server.use(
      http.post(quotesUrl, async ({ request }) => {
        received.push(await request.json());
        return respond(received.length - 1);
      }),
    );
  }

  describe('escenario 1: cotización exitosa de una reserva directa nueva', () => {
    it('una cotización por habitación con roomType, checkInDate y checkOutDate, sin guestCount', async () => {
      module3Responds((call) => HttpResponse.json(rateQuote(QUOTE_IDS[call])));

      await rates.quoteRooms([ROOM_1, ROOM_2], 'NEW_RESERVATION');

      expect(received).toEqual([
        {
          roomType: 'DOBLE',
          checkInDate: '2026-10-10',
          checkOutDate: '2026-10-12',
        },
        {
          roomType: 'DOBLE',
          checkInDate: '2026-10-10',
          checkOutDate: '2026-10-12',
        },
      ]);
    });

    it('cada habitación recibe su quoteId y el lodgingAmount exacto, en el orden de la solicitud', async () => {
      module3Responds((call) => HttpResponse.json(rateQuote(QUOTE_IDS[call])));

      const quotes = await rates.quoteRooms(
        [ROOM_1, ROOM_2],
        'NEW_RESERVATION',
      );

      expect(quotes.map(({ key }) => key)).toEqual(['1', '2']);
      expect(new Set(quotes.map(({ quoteId }) => quoteId))).toEqual(
        new Set(QUOTE_IDS.slice(0, 2)),
      );
      for (const quote of quotes) {
        expect(quote.currency).toBe('COP');
        expect(quote.lodgingAmount.amountWithCents).toBe('530000.00');
        expect(quote.lodgingAmount.currency).toBe('COP');
        expect(
          quote.nightlyRates.map(({ date, rate }) => [
            date,
            rate.amountWithCents,
          ]),
        ).toEqual([
          ['2026-10-10', '250000.00'],
          ['2026-10-11', '280000.00'],
        ]);
      }
    });
  });

  describe('escenario 2: el Módulo 3 no responde', () => {
    const pricingUnavailable = expect.objectContaining({
      errorCode: PRICING_UNAVAILABLE.code,
      message: PRICING_UNAVAILABLE.message,
    });

    it('responde después del tiempo máximo de espera: PRICING_UNAVAILABLE con el mensaje literal', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      module3Responds(async () => {
        await delay(timeoutMs + 500);
        return HttpResponse.json(rateQuote(QUOTE_IDS[0]));
      });

      await expect(
        rates.quoteRooms([ROOM_1], 'NEW_RESERVATION'),
      ).rejects.toEqual(pricingUnavailable);
    });

    it.each([
      ['un 503', () => new HttpResponse(null, { status: 503 })],
      ['sin conexión (error de red)', () => HttpResponse.error()],
      [
        'un cuerpo que no es JSON',
        () => new HttpResponse('Servicio en mantenimiento', { status: 200 }),
      ],
      [
        'un lodgingAmount en cero, que nunca se asume',
        () =>
          HttpResponse.json({
            ...(rateQuote(QUOTE_IDS[0]) as object),
            lodgingAmount: '0.00',
          }),
      ],
    ])(
      'con %s: PRICING_UNAVAILABLE, sin asumir ninguna tarifa',
      async (_, respond) => {
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        module3Responds(respond);

        await expect(
          rates.quoteRooms([ROOM_1], 'NEW_RESERVATION'),
        ).rejects.toEqual(pricingUnavailable);
      },
    );

    it('todo o nada (FR-002a): si falla una de tres, no devuelve ninguna cotización', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      module3Responds((call) =>
        call === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json(rateQuote(QUOTE_IDS[call])),
      );

      await expect(
        rates.quoteRooms(
          [ROOM_1, ROOM_2, { ...ROOM_1, key: '3' }],
          'NEW_RESERVATION',
        ),
      ).rejects.toEqual(pricingUnavailable);
    });
  });

  describe('caso borde: categoría inexistente, nunca 500', () => {
    const invalidCategory = expect.objectContaining({
      errorCode: INVALID_CATEGORY.code,
      message: INVALID_CATEGORY.message,
    });

    it('el Módulo 3 no conoce la categoría (404): INVALID_CATEGORY', async () => {
      module3Responds(() => new HttpResponse(null, { status: 404 }));

      await expect(
        rates.quoteRooms(
          [{ ...ROOM_1, categoryRoom: 'PENTHOUSE' }],
          'NEW_RESERVATION',
        ),
      ).rejects.toEqual(invalidCategory);
      expect(received).toEqual([
        {
          roomType: 'PENTHOUSE',
          checkInDate: '2026-10-10',
          checkOutDate: '2026-10-12',
        },
      ]);
    });

    it.each([
      ['en minúsculas', 'doble'],
      ['vacía', ''],
    ])(
      'una categoría %s: INVALID_CATEGORY sin llamar al Módulo 3',
      async (_, categoryRoom) => {
        module3Responds(() => HttpResponse.json(rateQuote(QUOTE_IDS[0])));

        await expect(
          rates.quoteRooms([{ ...ROOM_1, categoryRoom }], 'NEW_RESERVATION'),
        ).rejects.toEqual(invalidCategory);
        expect(received).toEqual([]);
      },
    );
  });
});
