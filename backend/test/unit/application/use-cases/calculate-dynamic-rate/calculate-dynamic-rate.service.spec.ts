import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RateQuote,
  RoomQuoteRequest,
} from '../../../../../src/application/integration/rate-quote.js';
import {
  Module3RejectedError,
  Module3UnavailableError,
  type Module3Port,
} from '../../../../../src/application/ports/out/module3.port.js';
import { CalculateDynamicRateService } from '../../../../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.service.js';
import { Money } from '../../../../../src/domain/shared/money.js';

const cop = (amount: string) => Money.of(amount, 'COP');

/** La cotización del ejemplo de A1 del plan: dos noches de `DOBLE`. */
function aQuote(quoteId: string): RateQuote {
  return {
    quoteId,
    currency: 'COP',
    nightlyRates: [
      { date: '2026-10-10', rate: cop('250000.00') },
      { date: '2026-10-11', rate: cop('280000.00') },
    ],
    lodgingAmount: cop('530000.00'),
  };
}

const aRequest = (
  changes: Partial<RoomQuoteRequest> = {},
): RoomQuoteRequest => ({
  key: '1',
  categoryRoom: 'DOBLE',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  ...changes,
});

/** El servicio con el Módulo 3 simulado: por defecto cotiza cualquier habitación con el ejemplo de A1. */
function serviceWith(
  createQuote: Module3Port['createQuote'] = (roomType) =>
    Promise.resolve(aQuote(`Q-${roomType}`)),
  concurrency = 5,
) {
  const fake = vi.fn(createQuote);
  const service = new CalculateDynamicRateService(
    { createQuote: fake } as Module3Port,
    concurrency,
  );
  return { service, createQuote: fake };
}

describe('CalculateDynamicRate.quoteRooms (T008)', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cotiza cada habitación al Módulo 3 y devuelve su cotización con la key de la solicitud', async () => {
    const { service, createQuote } = serviceWith();

    const quotes = await service.quoteRooms(
      [
        aRequest({ key: '1' }),
        aRequest({ key: '2', categoryRoom: 'SUITE_JUNIOR' }),
      ],
      'NEW_RESERVATION',
    );

    expect(quotes).toEqual([
      { ...aQuote('Q-DOBLE'), key: '1' },
      { ...aQuote('Q-SUITE_JUNIOR'), key: '2' },
    ]);
    expect(createQuote.mock.calls).toEqual([
      ['DOBLE', '2026-10-10', '2026-10-12'],
      ['SUITE_JUNIOR', '2026-10-10', '2026-10-12'],
    ]);
  });

  it('sin habitaciones no llama al Módulo 3', async () => {
    const { service, createQuote } = serviceWith();

    await expect(service.quoteRooms([], 'NEW_RESERVATION')).resolves.toEqual(
      [],
    );
    expect(createQuote).not.toHaveBeenCalled();
  });

  describe('validación, antes de llamar al Módulo 3 (T005)', () => {
    it.each<[string, Partial<RoomQuoteRequest>, string, string]>([
      [
        'una categoría con otra forma',
        { categoryRoom: 'doble' },
        'INVALID_CATEGORY',
        'La categoría indicada no es válida.',
      ],
      [
        'una categoría vacía',
        { categoryRoom: '' },
        'INVALID_CATEGORY',
        'La categoría indicada no es válida.',
      ],
      [
        'la salida antes de la llegada',
        { startDate: '2026-10-12', endDate: '2026-10-10' },
        'INVALID_STAY_DATES',
        'Rango de fechas inválido. Verifique las fechas seleccionadas.',
      ],
      [
        'una fecha que no existe',
        { startDate: '2026-02-30', endDate: '2026-03-02' },
        'INVALID_STAY_DATES',
        'Rango de fechas inválido. Verifique las fechas seleccionadas.',
      ],
    ])('con %s da %s', async (_caso, changes, errorCode, message) => {
      const { service, createQuote } = serviceWith();

      await expect(
        service.quoteRooms([aRequest(changes)], 'NEW_RESERVATION'),
      ).rejects.toMatchObject({ errorCode, message });
      expect(createQuote).not.toHaveBeenCalled();
    });

    it('valida todas antes de cotizar: si la segunda es inválida, no cotiza ni la primera', async () => {
      const { service, createQuote } = serviceWith();

      await expect(
        service.quoteRooms(
          [
            aRequest({ key: '1' }),
            aRequest({ key: '2', categoryRoom: 'doble' }),
          ],
          'NEW_RESERVATION',
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_CATEGORY' });
      expect(createQuote).not.toHaveBeenCalled();
    });
  });

  describe('rechazos del Módulo 3', () => {
    it('un 404 (BASE_RATE_NOT_FOUND, categoría sin tarifa base) da INVALID_CATEGORY', async () => {
      const { service } = serviceWith(() =>
        Promise.reject(new Module3RejectedError(404)),
      );

      await expect(
        service.quoteRooms([aRequest()], 'NEW_RESERVATION'),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_CATEGORY',
        message: 'La categoría indicada no es válida.',
      });
    });

    it.each(['NEW_RESERVATION', 'RECALCULATION'] as const)(
      'otro 4xx (400 INVALID_DATE_RANGE) da INVALID_STAY_DATES, también en %s',
      async (context) => {
        const { service } = serviceWith(() =>
          Promise.reject(new Module3RejectedError(400)),
        );

        await expect(
          service.quoteRooms([aRequest()], context),
        ).rejects.toMatchObject({ errorCode: 'INVALID_STAY_DATES' });
      },
    );
  });

  describe('el Módulo 3 no responde: el mensaje según el contexto (T009)', () => {
    const unavailable = () =>
      Promise.reject(new Module3UnavailableError('tiempo de espera agotado'));

    it('en una reserva nueva da PRICING_UNAVAILABLE, con su mensaje literal', async () => {
      const { service } = serviceWith(unavailable);

      await expect(
        service.quoteRooms([aRequest()], 'NEW_RESERVATION'),
      ).rejects.toMatchObject({
        errorCode: 'PRICING_UNAVAILABLE',
        message:
          'Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde',
      });
    });

    it('al recotizar da RECALCULATION_UNAVAILABLE, con su mensaje literal', async () => {
      const { service } = serviceWith(unavailable);

      await expect(
        service.quoteRooms([aRequest()], 'RECALCULATION'),
      ).rejects.toMatchObject({
        errorCode: 'RECALCULATION_UNAVAILABLE',
        message:
          'No se pudo calcular la nueva tarifa en este momento. Intente más tarde.',
      });
    });

    it('el detalle va al log, con la categoría y las fechas', async () => {
      const { service } = serviceWith(unavailable);

      await service
        .quoteRooms([aRequest()], 'NEW_RESERVATION')
        .catch(() => undefined);

      expect(warnings).toEqual([
        'Cotización de DOBLE del 2026-10-10 al 2026-10-12: El Módulo 3 no está disponible: tiempo de espera agotado.',
      ]);
    });
  });

  describe('todo o nada', () => {
    it('si falla una sola habitación, fallan todas y no se devuelve ninguna cotización', async () => {
      const { service } = serviceWith((roomType) =>
        roomType === 'SUITE_JUNIOR'
          ? Promise.reject(new Module3UnavailableError('respondió 503'))
          : Promise.resolve(aQuote('Q-1')),
      );

      await expect(
        service.quoteRooms(
          [
            aRequest({ key: '1' }),
            aRequest({ key: '2', categoryRoom: 'SUITE_JUNIOR' }),
          ],
          'NEW_RESERVATION',
        ),
      ).rejects.toMatchObject({ errorCode: 'PRICING_UNAVAILABLE' });
    });

    it('un error inesperado sale tal cual, sin traducir', async () => {
      const unexpected = new Error('falla del programa');
      const { service } = serviceWith(() => Promise.reject(unexpected));

      await expect(
        service.quoteRooms([aRequest()], 'NEW_RESERVATION'),
      ).rejects.toBe(unexpected);
    });
  });

  it.each([1, 2, 4])(
    'con QUOTE_CONCURRENCY en %i nunca hay más cotizaciones a la vez',
    async (concurrency) => {
      const state = { running: 0, maxRunning: 0 };
      const { service } = serviceWith(async () => {
        state.running++;
        state.maxRunning = Math.max(state.maxRunning, state.running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.running--;
        return aQuote('Q');
      }, concurrency);

      await service.quoteRooms(
        ['1', '2', '3', '4', '5', '6'].map((key) => aRequest({ key })),
        'NEW_RESERVATION',
      );

      expect(state.maxRunning).toBe(concurrency);
    },
  );
});
