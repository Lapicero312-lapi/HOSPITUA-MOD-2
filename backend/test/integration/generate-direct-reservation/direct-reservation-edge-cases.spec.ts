import type { INestApplication } from '@nestjs/common';
import { setupServer } from 'msw/node';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { Clock } from '../../../src/application/ports/out/clock.js';
import { truncateAllTables } from '../support/database.js';
import {
  aBody,
  createDirect,
  freshModules,
  ROOM_101,
  type SimulatedModules,
  simulate,
  startDirectReservationApp,
} from '../support/direct-reservation-app.js';

const TODAY = '2033-04-01';
const START = '2033-04-10';
const END = '2033-04-12';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date(`${TODAY}T15:00:00.000Z`),
};

/**
 * T012 de `generate-direct-reservation`: los casos borde de "Pruebas por escenario" (fechas, habitaciones,
 * personas, `notes`, Módulo 3 parcial, persistencia y la tarifa que cambió), con la aplicación completa,
 * PostgreSQL y RabbitMQ reales y los Módulos 1 y 3 simulados en HTTP (msw). La concurrencia por la última
 * habitación es de T013 (`direct-reservation-concurrency.spec.ts`). En cada rechazo se comprueba el código, el
 * mensaje literal de la tabla C y que no se guardó nada.
 */
describe('Generar reserva directa: casos borde (T012)', () => {
  const server = setupServer();
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const modules: SimulatedModules = freshModules();

  const saved = async (): Promise<number> => {
    const [{ count }]: { count: number }[] = await dataSource.query(
      'SELECT count(*)::int AS count FROM reservation',
    );
    return count;
  };

  /** B rechaza el cuerpo con ese código y mensaje, y no queda ninguna reserva. */
  const expectRejected = async (
    body: object,
    errorCode: string,
    message: string,
  ) => {
    const res = await createDirect(app, body).expect(400);
    expect(res.body).toMatchObject({ errorCode, message });
    expect(await saved()).toBe(0);
  };

  beforeAll(async () => {
    app = await startDirectReservationApp(clock);
    dataSource = app.get(DataSource);
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    Object.assign(modules, freshModules());
    await truncateAllTables(dataSource);
    simulate(server, app, modules);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  describe('fechas: 400 sin consultar la disponibilidad ni cotizar', () => {
    it.each([
      ['la salida antes de la entrada', END, START],
      ['la salida igual a la entrada', START, START],
      ['la entrada vacía', '', END],
      ['la salida vacía', START, ''],
      ['una fecha que no existe', START, '2033-02-30'],
    ])('%s: INVALID_RESERVATION_DATES', async (_case, startDate, endDate) => {
      await expectRejected(
        aBody(startDate, endDate),
        'INVALID_RESERVATION_DATES',
        'La fecha de salida debe ser posterior a la de entrada.',
      );
      expect(modules.maintenanceCalls).toBe(0);
      expect(modules.quoteCalls).toBe(0);
    });
  });

  describe('habitaciones', () => {
    it('la misma habitación dos veces: ROOM_ALREADY_IN_RESERVATION', async () => {
      await expectRejected(
        aBody(START, END, [
          { guestCount: 1, roomId: ROOM_101.id },
          { guestCount: 1, roomId: ROOM_101.id },
        ]),
        'ROOM_ALREADY_IN_RESERVATION',
        'La habitación ya forma parte de la reserva.',
      );
    });

    it.each([
      ['ninguna', 0],
      ['11', 11],
    ])('%s habitaciones: INVALID_ROOM_COUNT', async (_case, count) => {
      await expectRejected(
        aBody(
          START,
          END,
          Array.from({ length: count }, () => ({ guestCount: 1 })),
        ),
        'INVALID_ROOM_COUNT',
        'Una reserva debe tener entre 1 y 10 habitaciones.',
      );
      expect(modules.quoteCalls).toBe(0);
    });
  });

  describe('personas', () => {
    it.each([
      ['con decimales', 1.5],
      ['negativas', -1],
      ['como texto', '2'],
    ])('%s: INVALID_GUEST_COUNT', async (_case, guestCount) => {
      await expectRejected(
        aBody(START, END, [{ guestCount }]),
        'INVALID_GUEST_COUNT',
        'La cantidad de personas debe ser un número entero mayor que cero.',
      );
    });
  });

  it('el Módulo 3 cotiza una habitación y falla con la otra: PRICING_UNAVAILABLE y no se crea la reserva', async () => {
    modules.failingCalls = [2];

    await expectRejected(
      aBody(START, END, [{ guestCount: 2 }, { guestCount: 2 }]),
      'PRICING_UNAVAILABLE',
      'Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde',
    );
    expect(modules.quoteCalls).toBe(2);
  });

  describe('notes', () => {
    it('más de 500 caracteres: NOTES_TOO_LONG', async () => {
      await expectRejected(
        aBody(START, END, undefined, { notes: 'a'.repeat(501) }),
        'NOTES_TOO_LONG',
        'Las observaciones no pueden superar 500 caracteres.',
      );
    });

    it('un carácter de control: INVALID_CHARACTERS', async () => {
      await expectRejected(
        aBody(START, END, undefined, { notes: 'Llega \u0007 tarde' }),
        'INVALID_CHARACTERS',
        'El formato de los datos contiene caracteres no válidos.',
      );
    });

    it('con 500 caracteres justos, se crea', async () => {
      await createDirect(
        app,
        aBody(START, END, undefined, { notes: 'a'.repeat(500) }),
      ).expect(201);
      expect(await saved()).toBe(1);
    });
  });

  it('D1: la tarifa cambió entre la vista previa y la creación: RATE_CHANGED y nada se guarda', async () => {
    modules.lodgingByCall = { 1: '550000.00' };

    await expectRejected(
      aBody(START, END),
      'RATE_CHANGED',
      'La tarifa cambió, vuelva a cotizar.',
    );
  });

  describe('persistencia (FR-002 y FR-006)', () => {
    it('sin columna de total ni de IVA en la reserva ni en sus habitaciones', async () => {
      const columns: { column_name: string }[] = await dataSource.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name IN ('reservation', 'reservation_room')`,
      );

      const names = columns.map(({ column_name }) => column_name);
      expect(
        names.filter((name) => /(^|_)(total|iva|tax|vat)(_|$)/i.test(name)),
      ).toEqual([]);
    });

    it('una reserva directa guarda la comisión en 0, y la base rechaza otra comisión para el canal DIRECT', async () => {
      const res = await createDirect(app, aBody(START, END)).expect(201);
      const [row]: {
        id: string;
        commission_percentage: string;
        commission_amount: string;
      }[] = await dataSource.query(
        `SELECT id, commission_percentage::text, commission_amount::text
         FROM reservation WHERE reservation_ref = $1`,
        [res.body.reservationRef],
      );

      expect(Number(row.commission_percentage)).toBe(0);
      expect(Number(row.commission_amount)).toBe(0);
      await expect(
        dataSource.query(
          'UPDATE reservation SET commission_amount = 10 WHERE id = $1',
          [row.id],
        ),
      ).rejects.toThrow(/check constraint/i);
    });
  });
});
