import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { RoomQuoteRequest } from '../../../src/application/integration/room-quote.js';
import { CalculateDynamicRateModule } from '../../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import { BusinessError } from '../../../src/domain/shared/business-error.js';
import { PRICING_UNAVAILABLE } from '../../../src/domain/shared/error-codes.js';
import { AppConfigModule } from '../../../src/infrastructure/config/app-config.module.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { Module3ClientModule } from '../../../src/infrastructure/out/module3/module3-client.module.js';
import { captureLogs } from '../support/capture-logs.js';

/**
 * Lo que `calculate-dynamic-rate` escribe en el log (T022): ningún dato personal, y los importes que se
 * rechazan, tal como los envió el Módulo 3, sin redondear (plan, "Precisión del dinero": "se rechaza la
 * respuesta y se registra, en vez de redondear y alterar el valor del Módulo 3"). Todo es real salvo el
 * Módulo 3, que se simula en HTTP (msw).
 */

/** Una habitación `DOBLE` del ejemplo de A1 del plan: dos noches, del 10 al 12 de octubre. */
const REQUEST: RoomQuoteRequest = {
  key: '1',
  categoryRoom: 'DOBLE',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
};

/** La respuesta de A1, escrita como texto para no tocar los decimales. */
const quoteBody = (lodgingAmount: string, firstNightRate = '250000.00') =>
  `{"quoteId":"a1f2c3d4-e5b6-4789-8a9b-0c1d2e3f4a5b","currency":"COP","nightlyRates":` +
  `[{"date":"2026-10-10","rate":${firstNightRate}},{"date":"2026-10-11","rate":280000.00}],` +
  `"lodgingAmount":${lodgingAmount}}`;

const server = setupServer();

describe('CalculateDynamicRate: lo que escribe en el log (T022)', () => {
  let moduleRef: TestingModule;
  let rates: CalculateDynamicRate;
  let quotesUrl: string;
  let logs: string[];

  /** El Módulo 3 responde ese cuerpo. */
  const module3Answers = (body: string) =>
    server.use(
      http.post(
        quotesUrl,
        () =>
          new HttpResponse(body, {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

  /** Cotiza la habitación y devuelve el error, que tiene que ser el de la tabla del plan. */
  const quoteFailing = async (): Promise<BusinessError> => {
    const error: unknown = await rates
      .quoteRooms([REQUEST], 'NEW_RESERVATION')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BusinessError);
    expect(error).toMatchObject({
      errorCode: PRICING_UNAVAILABLE.code,
      message: PRICING_UNAVAILABLE.message,
    });
    return error as BusinessError;
  };

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        Module3ClientModule,
        CalculateDynamicRateModule,
      ],
    }).compile();
    rates = moduleRef.get<CalculateDynamicRate>(CALCULATE_DYNAMIC_RATE);
    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    quotesUrl = `${config.get('MODULE3_BASE_URL', { infer: true })}/pricing/quotes`;
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await moduleRef?.close();
  });

  it.each([
    ['con tres decimales', '530000.105'],
    ['que number redondearía a dos decimales', '530000.1000000000000000055'],
    ['negativo', '-530000'],
  ])(
    'un lodgingAmount %s se rechaza y el log lo escribe tal como llegó',
    async (_case, lodgingAmount) => {
      module3Answers(quoteBody(lodgingAmount));

      await quoteFailing();

      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain(`lodgingAmount`);
      expect(logs[0]).toContain(`(${lodgingAmount})`);
    },
  );

  it('el valor no se redondea en el log: 530000.105 no aparece como 530000.11 ni 530000.1', async () => {
    module3Answers(quoteBody('530000.105'));

    await quoteFailing();

    expect(logs[0]).not.toMatch(/530000\.1[01]?\)/);
  });

  it('un lodgingAmount en cero se rechaza y el log lo escribe tal como llegó', async () => {
    module3Answers(quoteBody('0.00'));

    await quoteFailing();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('lodgingAmount en cero (0.00)');
  });

  it('una tarifa por noche con más de dos decimales se rechaza y el log dice cuál noche y con qué valor', async () => {
    module3Answers(quoteBody('530000.00', '250000.055'));

    await quoteFailing();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('la tarifa del 2026-10-10');
    expect(logs[0]).toContain('(250000.055)');
  });

  it('un importe con otro tipo se escribe en JSON', async () => {
    module3Answers(quoteBody('{"value":530000}'));

    await quoteFailing();

    expect(logs[0]).toContain('({"value":"530000"})');
  });

  it('el importe va solo al log: el error que recibe quien cotiza es el mensaje literal, sin el valor', async () => {
    module3Answers(quoteBody('530000.105'));

    const error = await quoteFailing();

    expect(error.message).not.toContain('530000');
  });

  it('el log solo lleva la categoría, las fechas y el motivo: ningún dato personal ni el quoteId', async () => {
    module3Answers(quoteBody('530000.105'));

    await quoteFailing();

    // La cotización no tiene datos de personas (A1): ni titular, ni documento, ni contacto.
    expect(logs[0]).toBe(
      'Cotización de DOBLE del 2026-10-10 al 2026-10-12: El Módulo 3 no está disponible: ' +
        'cotización inválida: lodgingAmount con otro formato o con más de dos decimales (530000.105).',
    );
  });

  it('una cotización válida no escribe nada en el log', async () => {
    module3Answers(quoteBody('530000.00'));

    const [quote] = await rates.quoteRooms([REQUEST], 'NEW_RESERVATION');

    expect(quote.lodgingAmount.amount).toBe('530000');
    expect(logs).toEqual([]);
  });
});
