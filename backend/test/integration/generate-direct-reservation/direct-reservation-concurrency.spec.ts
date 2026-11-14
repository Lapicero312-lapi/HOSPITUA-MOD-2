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
  aGate,
  createDirect,
  freshModules,
  ROOM_101,
  ROOM_102,
  type SimulatedModules,
  simulate,
  startDirectReservationApp,
} from '../support/direct-reservation-app.js';

const TODAY = '2033-05-01';
const START = '2033-05-10';
const END = '2033-05-12';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date(`${TODAY}T15:00:00.000Z`),
};

/**
 * T013 de `generate-direct-reservation`: dos solicitudes simultáneas por la última habitación (caso borde
 * "Concurrencia": "una `201`, la otra `AVAILABILITY_TAKEN` (o toma otra habitación libre)"; D3 y punto 14).
 *
 * Para que las dos lleguen de verdad a la vez al guardado, el Módulo 3 simulado retiene las cotizaciones
 * hasta que las dos solicitudes ya verificaron la disponibilidad y vieron la misma habitación libre; entonces
 * las suelta juntas. La restricción anti-solape de la base decide cuál gana.
 */
describe('Generar reserva directa: dos solicitudes por la última habitación (T013)', () => {
  const server = setupServer();
  let app: INestApplication<App>;
  let dataSource: DataSource;
  const modules: SimulatedModules = freshModules();

  const roomsTaken = (): Promise<{ room_number: string }[]> =>
    dataSource.query(
      'SELECT room_number FROM reservation_room ORDER BY room_number',
    );

  /** Las dos solicitudes a la vez, soltadas juntas cuando las dos esperan su cotización. */
  const twoAtOnce = async () => {
    const gate = aGate();
    modules.quoteGate = gate;
    const first = createDirect(app, aBody(START, END)).then((res) => res);
    const second = createDirect(app, aBody(START, END)).then((res) => res);
    await gate.reached(2);
    gate.release();
    return Promise.all([first, second]);
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

  it('con una sola habitación libre: una 201 y la otra 400 AVAILABILITY_TAKEN, y una sola reserva guardada', async () => {
    modules.rooms = [ROOM_101];

    const answers = await twoAtOnce();

    const statuses = answers.map(({ status }) => status).sort();
    expect(statuses).toEqual([201, 400]);
    const rejected = answers.find(({ status }) => status === 400);
    expect(rejected?.body).toMatchObject({
      errorCode: 'AVAILABILITY_TAKEN',
      message: 'Ya no hay disponibilidad para las fechas solicitadas.',
    });
    expect(await roomsTaken()).toEqual([{ room_number: '101' }]);
    const [{ count }]: { count: number }[] = await dataSource.query(
      'SELECT count(*)::int AS count FROM reservation',
    );
    expect(count).toBe(1);
    // Los avisos de la que perdió se revirtieron con su transacción: una sola marca para Channex.
    const [{ marks }]: { marks: number }[] = await dataSource.query(
      'SELECT count(*)::int AS marks FROM ari_pending_change',
    );
    expect(marks).toBe(1);
  });

  it('con otra habitación libre: las dos se crean, la que perdió la 101 toma la 102', async () => {
    modules.rooms = [ROOM_101, ROOM_102];

    const answers = await twoAtOnce();

    expect(answers.map(({ status }) => status)).toEqual([201, 201]);
    expect(await roomsTaken()).toEqual([
      { room_number: '101' },
      { room_number: '102' },
    ]);
  });
});
