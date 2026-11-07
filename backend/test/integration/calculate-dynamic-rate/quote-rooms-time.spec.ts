import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomQuoteRequest } from '../../../src/application/integration/room-quote.js';
import { CalculateDynamicRateModule } from '../../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import { AppConfigModule } from '../../../src/infrastructure/config/app-config.module.js';
import type { EnvironmentVariables } from '../../../src/infrastructure/config/env.validation.js';
import { RateReferenceConfigModule } from '../../../src/infrastructure/config/rate-reference.config.js';
import { Module3ClientModule } from '../../../src/infrastructure/out/module3/module3-client.module.js';

/**
 * Prueba de tiempo de `calculate-dynamic-rate` (T021, NFR-001). El dato es el del plan ("Pruebas por
 * escenario"): 10 cotizaciones en paralelo en menos de 1,5 s con el Módulo 3 simulado a 300 ms.
 *
 * Todo es real salvo el Módulo 3: los módulos de Nest, el adaptador HTTP y la configuración, con el tope
 * `QUOTE_CONCURRENCY` por defecto (5). El Módulo 3 se simula en HTTP (msw) y cada cotización tarda 300 ms.
 * Una tras otra serían 3 s; con el tope de 5 son dos tandas, unos 600 ms.
 */

const MODULE3_DELAY_MS = 300;
const ROOM_COUNT = 10;
const LIMIT_MS = 1500;

/** 10 habitaciones `DOBLE` con la estadía del ejemplo de A1 del plan: dos noches, del 10 al 12 de octubre. */
const REQUESTS: RoomQuoteRequest[] = Array.from(
  { length: ROOM_COUNT },
  (_, index) => ({
    key: String(index + 1),
    categoryRoom: 'DOBLE',
    startDate: '2026-10-10',
    endDate: '2026-10-12',
  }),
);

const server = setupServer();

describe('CalculateDynamicRate.quoteRooms: tiempo de respuesta (T021, NFR-001)', () => {
  let moduleRef: TestingModule;
  let rates: CalculateDynamicRate;
  /** Las cotizaciones que recibió el Módulo 3, y cuántas hubo en curso a la vez como máximo. */
  const module3 = { requests: 0, running: 0, maxRunning: 0 };
  let concurrency: number;

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        // Lo pone AppModule: CalculateDynamicRateModule también arma GetReferenceRates (#486).
        RateReferenceConfigModule,
        Module3ClientModule,
        CalculateDynamicRateModule,
      ],
    }).compile();
    rates = moduleRef.get<CalculateDynamicRate>(CALCULATE_DYNAMIC_RATE);

    const config =
      moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    concurrency = config.get('QUOTE_CONCURRENCY', { infer: true });
    const quotesUrl = `${config.get('MODULE3_BASE_URL', { infer: true })}/pricing/quotes`;
    let quoteNumber = 0;
    server.use(
      http.post(quotesUrl, async () => {
        module3.requests += 1;
        module3.running += 1;
        module3.maxRunning = Math.max(module3.maxRunning, module3.running);
        // Se toma antes de esperar: si no, las que terminan juntas leerían el mismo número.
        quoteNumber += 1;
        const quoteId = `00000000-0000-4000-8000-${String(quoteNumber).padStart(12, '0')}`;
        await delay(MODULE3_DELAY_MS);
        module3.running -= 1;
        return HttpResponse.json({
          quoteId,
          currency: 'COP',
          nightlyRates: [
            { date: '2026-10-10', rate: '250000.00' },
            { date: '2026-10-11', rate: '280000.00' },
          ],
          lodgingAmount: '530000.00',
        });
      }),
    );
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(async () => {
    server.close();
    await moduleRef?.close();
  });

  it(`${ROOM_COUNT} habitaciones con el Módulo 3 a ${MODULE3_DELAY_MS} ms se cotizan en menos de 1,5 s`, async () => {
    // Una cotización antes de medir: la primera conexión al Módulo 3 no es una "condición normal".
    await rates.quoteRooms(REQUESTS.slice(0, 1), 'NEW_RESERVATION');
    Object.assign(module3, { requests: 0, running: 0, maxRunning: 0 });

    const start = performance.now();
    const quotes = await rates.quoteRooms(REQUESTS, 'NEW_RESERVATION');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(LIMIT_MS);
    // Es la cotización completa: una llamada y una cotización por habitación, cada una con su clave.
    expect(module3.requests).toBe(ROOM_COUNT);
    expect(quotes.map((quote) => quote.key)).toEqual(
      REQUESTS.map((request) => request.key),
    );
    expect(new Set(quotes.map((quote) => quote.quoteId)).size).toBe(ROOM_COUNT);
    expect(
      quotes.every((quote) => quote.lodgingAmount.amount === '530000'),
    ).toBe(true);
    // Lo que la hace rápida: las llamadas van en paralelo, sin pasar el tope.
    expect(concurrency).toBe(5);
    expect(module3.maxRunning).toBeGreaterThan(1);
    expect(module3.maxRunning).toBeLessThanOrEqual(concurrency);
  });
});
