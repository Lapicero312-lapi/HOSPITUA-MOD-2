import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Module3RejectedError,
  Module3UnavailableError,
} from '../../src/application/ports/out/module3.port.js';
import { Module3HttpAdapter } from '../../src/infrastructure/out/module3/module3-http.adapter.js';

const BASE_URL = 'http://module3.test';
const URL_QUOTES = `${BASE_URL}/pricing/quotes`;
const TIMEOUT_MS = 200;

/** Respuesta de ejemplo del contrato (calculate-dynamic-rate, A1), escrita como texto para no tocar los decimales. */
const quoteBody = (lodgingAmount = '530000.10', rate = '250000.05') =>
  `{"quoteId":"Q-12345","currency":"COP","nightlyRates":[{"date":"2026-10-10","rate":${rate}},` +
  `{"date":"2026-10-11","rate":280000.05}],"lodgingAmount":${lodgingAmount}}`;

const json = (body: string, status = 200) =>
  new HttpResponse(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const server = setupServer();

describe('Module3HttpAdapter contra respuestas simuladas del Módulo 3', () => {
  const adapter = new Module3HttpAdapter(
    new HttpService(axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS })),
  );
  const quote = () => adapter.createQuote('DOBLE', '2026-10-10', '2026-10-12');

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('envía roomType, checkInDate y checkOutDate, y devuelve la cotización', async () => {
    let sent: unknown = null;
    server.use(
      http.post(URL_QUOTES, async ({ request }) => {
        sent = await request.json();
        return json(quoteBody());
      }),
    );

    const result = await quote();

    expect(sent).toEqual({
      roomType: 'DOBLE',
      checkInDate: '2026-10-10',
      checkOutDate: '2026-10-12',
    });
    expect(result.quoteId).toBe('Q-12345');
    expect(result.currency).toBe('COP');
    expect(result.nightlyRates.map((night) => night.date)).toEqual([
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('conserva exacto el mayor importe de una columna numeric(14,2)', async () => {
    server.use(
      http.post(URL_QUOTES, () => json(quoteBody('999999999999.99', '0.10'))),
    );

    const result = await quote();

    expect(result.lodgingAmount.amount).toBe('999999999999.99');
    expect(result.nightlyRates[0].rate.amount).toBe('0.1');
    expect(result.lodgingAmount.currency).toBe('COP');
  });

  it('acepta los importes como texto', async () => {
    server.use(
      http.post(URL_QUOTES, () =>
        json(quoteBody('"530000.10"', '"250000.05"')),
      ),
    );

    expect((await quote()).lodgingAmount.amount).toBe('530000.1');
  });

  it.each([
    ['con más de dos decimales', quoteBody('530000.105')],
    [
      'que number redondearía a dos decimales',
      quoteBody('530000.1000000000000000055'),
    ],
    ['en cero', quoteBody('0.00')],
    ['negativo', quoteBody('-530000')],
    ['sin quoteId', quoteBody().replace('"quoteId":"Q-12345",', '')],
    ['con una moneda inválida', quoteBody().replace('"COP"', '"pesos"')],
    [
      'con una noche fuera de la estadía',
      quoteBody().replace('2026-10-11', '2026-10-12'),
    ],
  ])(
    'una cotización %s es Module3UnavailableError y no se redondea',
    async (_, body) => {
      server.use(http.post(URL_QUOTES, () => json(body)));

      await expect(quote()).rejects.toBeInstanceOf(Module3UnavailableError);
    },
  );

  it.each([400, 404, 422])(
    'un %s (categoría o fechas rechazadas) es Module3RejectedError con su estado',
    async (status) => {
      server.use(http.post(URL_QUOTES, () => json('{}', status)));

      await expect(quote()).rejects.toEqual(new Module3RejectedError(status));
    },
  );

  it.each([500, 503])('un %s es Module3UnavailableError', async (status) => {
    server.use(http.post(URL_QUOTES, () => json('{}', status)));

    await expect(quote()).rejects.toBeInstanceOf(Module3UnavailableError);
  });

  it('si no responde en el tiempo máximo es Module3UnavailableError', async () => {
    server.use(
      http.post(URL_QUOTES, async () => {
        await delay(TIMEOUT_MS * 3);
        return json(quoteBody());
      }),
    );

    await expect(quote()).rejects.toThrow('tiempo de espera agotado');
  });

  it('sin conexión es Module3UnavailableError', async () => {
    server.use(http.post(URL_QUOTES, () => HttpResponse.error()));

    await expect(quote()).rejects.toBeInstanceOf(Module3UnavailableError);
  });
});
