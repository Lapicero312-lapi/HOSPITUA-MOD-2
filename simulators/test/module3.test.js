import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { module3Handler } from '../src/module3.js';
import { startSimulator } from './support.js';

const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Simulador del Módulo 3 (calculate-dynamic-rate, A1)', () => {
  /** @type {Awaited<ReturnType<typeof startSimulator>>} */
  let simulator;

  /** @param {unknown} body */
  const quote = (body) =>
    simulator.call('/pricing/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  before(async () => {
    simulator = await startSimulator(module3Handler());
  });

  after(async () => {
    await simulator.stop();
  });

  it('cotiza la estadía del ejemplo del plan con la tarifa fija de DOBLE', async () => {
    const { status, body } = await quote({
      roomType: 'DOBLE',
      checkInDate: '2026-10-10',
      checkOutDate: '2026-10-12',
    });

    assert.equal(status, 200);
    assert.match(body.quoteId, UUID_FORMAT);
    assert.deepEqual(
      { ...body, quoteId: 'cualquiera' },
      {
        quoteId: 'cualquiera',
        currency: 'COP',
        nightlyRates: [
          { date: '2026-10-10', rate: '220000.00' },
          { date: '2026-10-11', rate: '220000.00' },
        ],
        lodgingAmount: '440000.00',
      },
    );
  });

  it('la suite tiene su propia tarifa', async () => {
    const { body } = await quote({
      roomType: 'SUITE_JUNIOR',
      checkInDate: '2026-12-31',
      checkOutDate: '2027-01-01',
    });

    assert.deepEqual(body.nightlyRates, [
      { date: '2026-12-31', rate: '480000.00' },
    ]);
    assert.equal(body.lodgingAmount, '480000.00');
  });

  it('cada cotización trae un quoteId nuevo', async () => {
    const stay = {
      roomType: 'DOBLE',
      checkInDate: '2026-10-10',
      checkOutDate: '2026-10-11',
    };

    const [first, second] = await Promise.all([quote(stay), quote(stay)]);

    assert.notEqual(first.body.quoteId, second.body.quoteId);
  });

  it('una categoría sin tarifa base da 404 BASE_RATE_NOT_FOUND', async () => {
    const { status, body } = await quote({
      roomType: 'TRIPLE',
      checkInDate: '2026-10-10',
      checkOutDate: '2026-10-11',
    });

    assert.equal(status, 404);
    assert.equal(body.code, 'BASE_RATE_NOT_FOUND');
  });

  for (const [caso, body] of [
    [
      'sin categoría',
      { checkInDate: '2026-10-10', checkOutDate: '2026-10-11' },
    ],
    [
      'con una fecha mal formada',
      {
        roomType: 'DOBLE',
        checkInDate: '10/10/2026',
        checkOutDate: '2026-10-11',
      },
    ],
    [
      'con una fecha que no existe',
      {
        roomType: 'DOBLE',
        checkInDate: '2026-02-30',
        checkOutDate: '2026-03-02',
      },
    ],
    ['con un cuerpo que no es JSON', 'no es JSON'],
    ['con una lista en lugar de un objeto', []],
  ]) {
    it(`${caso} da 400 INVALID_QUERY_PARAMS`, async () => {
      const response = await quote(body);

      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'INVALID_QUERY_PARAMS');
    });
  }

  for (const [caso, checkInDate, checkOutDate] of [
    ['la salida igual a la llegada', '2026-10-10', '2026-10-10'],
    ['la salida antes de la llegada', '2026-10-12', '2026-10-10'],
    ['más de 366 noches', '2026-01-01', '2027-01-03'],
  ]) {
    it(`con ${caso} da 400 INVALID_DATE_RANGE`, async () => {
      const response = await quote({
        roomType: 'DOBLE',
        checkInDate,
        checkOutDate,
      });

      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'INVALID_DATE_RANGE');
    });
  }

  it('366 noches sí se cotizan', async () => {
    const { status, body } = await quote({
      roomType: 'DOBLE',
      checkInDate: '2026-01-01',
      checkOutDate: '2027-01-02',
    });

    assert.equal(status, 200);
    assert.equal(body.nightlyRates.length, 366);
    assert.equal(body.lodgingAmount, '80520000.00');
  });

  it('otra ruta o método da 404', async () => {
    assert.equal((await simulator.call('/pricing/quotes')).status, 404);
    assert.equal(
      (await simulator.call('/pricing/otra', { method: 'POST', body: '{}' }))
        .status,
      404,
    );
  });
});
