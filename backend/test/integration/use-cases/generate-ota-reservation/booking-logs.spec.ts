import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { DataSource } from 'typeorm';
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
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import { ChannexSyncJob } from '../../../../src/infrastructure/in/jobs/channex-sync.job.js';
import {
  aRevision,
  aSimulatedChannex,
  CHANNEX_API_KEY,
  CHANNEX_BASE_URL,
  CUSTOMER,
  DOBLE_TYPE,
  type SimulatedChannex,
  simulate,
  startBookingFeedApp,
  useBookingFeedEnv,
} from '../../support/booking-feed-app.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

const NEW_REVISION = '03dd7198-c5b7-493c-a889-74d0c2211de7';
const CANCEL_REVISION = '7a1c2e3f-4b5d-4c6e-8f70-81a2b3c4d5e6';

/**
 * Lo que no puede salir en un log: la clave de Channex y los datos del titular que envía Booking. El país
 * (`CO`, que se guarda como "Colombia") se deja fuera porque es también el del hotel.
 */
const SECRETS = [
  CHANNEX_API_KEY,
  CUSTOMER.name,
  CUSTOMER.surname,
  CUSTOMER.mail,
  CUSTOMER.phone,
];

/**
 * T013 de `generate-ota-reservation`: ni la clave de Channex ni los datos personales salen en los logs (NFR-002
 * del spec; plan, "La clave nunca se escribe en los logs" y los errores "sin datos personales"). La aplicación
 * completa, con PostgreSQL real, Channex y el Módulo 1 simulados en HTTP y sus logs como en producción, en
 * el nivel más bajo y dirigidos a la prueba; también se recoge lo que se escriba con `console`. Se recorre
 * cada camino del feed y del reporte de no-show, los que terminan bien y los que fallan, y se revisa todo
 * lo que se escribió.
 */
describe('generate-ota-reservation: los logs no escriben la clave de Channex ni datos personales (T013)', () => {
  const server = setupServer();
  let dataSource: DataSource;
  let app: INestApplication;
  let channex: SimulatedChannex;
  let written: string[] = [];
  let consoleLines: string[] = [];
  let today = '2026-11-09';
  const clock: Clock = {
    now: () => new Date(`${today}T15:00:00.000Z`),
    today: () => today,
  };

  const allLogs = () => [...written, ...consoleLines].join('\n');

  /** Ningún secreto en lo que se escribió; y algo se escribió, para que la prueba no pase en vacío. */
  const expectClean = (expected: string) => {
    const logs = allLogs();
    expect(logs).toContain(expected);
    for (const secret of SECRETS) {
      expect(logs, `el log tiene "${secret}"`).not.toContain(secret);
    }
  };

  const cycle = async () => {
    await expect(app.get(ChannexSyncJob).run()).resolves.toBe(true);
  };

  const mapDobleType = () =>
    dataSource.query(
      `INSERT INTO ota_room_type_mapping (channex_room_type_id, category_room, count_of_rooms, occupancy)
       VALUES ($1, 'DOBLE', 2, 2)`,
      [DOBLE_TYPE],
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    useBookingFeedEnv();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    today = '2026-11-09';
    channex = aSimulatedChannex();
    simulate(server, channex);
    written = [];
    consoleLines = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
    const logs = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    app = await startBookingFeedApp(clock, { logs });
  });

  afterEach(async () => {
    await app.close();
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('una reserva nueva, su repetición y su cancelación', async () => {
    await mapDobleType();
    channex.feed = [aRevision(NEW_REVISION)];
    await cycle();
    await cycle();
    channex.feed = [aRevision(CANCEL_REVISION, { status: 'cancelled' })];
    await cycle();

    expect(channex.acks).toEqual([NEW_REVISION, NEW_REVISION, CANCEL_REVISION]);
    expect(await dataSource.query(`SELECT status FROM reservation`)).toEqual([
      { status: 'CANCELLED' },
    ]);
    // El arranque de Channex deja su línea: el log no está vacío.
    expectClean('Channex');
  });

  it('una revisión sin relación de tipo: queda en el feed, con su motivo en el log', async () => {
    channex.feed = [aRevision(NEW_REVISION)];

    await cycle();

    expectClean('una habitación sin relación con una categoría');
  });

  it('una revisión ilegible (sin el código de Booking): queda en el feed, con su motivo en el log', async () => {
    await mapDobleType();
    channex.feed = [aRevision(NEW_REVISION, { ota_reservation_code: null })];

    await cycle();

    expectClean(`revisión ${NEW_REVISION} ilegible`);
  });

  it('la primera reserva sin la comisión reportada: COMMISSION_NOT_REPORTED en el log, sin datos del titular', async () => {
    await mapDobleType();
    channex.feed = [aRevision(NEW_REVISION, { ota_commission: null })];

    await cycle();

    expect(await dataSource.query('SELECT 1 FROM reservation')).toEqual([]);
    expectClean('COMMISSION_NOT_REPORTED');
  });

  it.each([
    [503, 'No se procesa nada'],
    [429, 'No se procesa nada'],
  ])(
    'el feed responde %i: el aviso en el log, sin la clave',
    async (status, expected) => {
      channex.feedStatus = status;

      await cycle();

      expectClean(expected);
    },
  );

  it('el feed responde 401: la conexión queda caída y el log no trae la clave', async () => {
    channex.feedStatus = 401;

    await cycle();

    expectClean('401');
  });

  it('el ack falla: el aviso en el log, sin la clave ni los datos del titular', async () => {
    await mapDobleType();
    channex.feed = [aRevision(NEW_REVISION)];
    channex.ackFails = true;

    await cycle();

    expectClean(`El ack de la revisión ${NEW_REVISION} no salió`);
  });

  it('el reporte de no-show con Channex caído: la reserva en NO_SHOW, el aviso en el log y nada más', async () => {
    await mapDobleType();
    channex.feed = [aRevision(NEW_REVISION)];
    await cycle();
    server.use(
      http.post(`${CHANNEX_BASE_URL}/api/v1/bookings/:id/no_show`, () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    // Pasó el día de llegada sin Check-In: el cierre la marca NO_SHOW y deja el reporte pendiente.
    today = '2026-11-11';
    await app.get<CloseDay>(CLOSE_DAY).execute('2026-11-10');
    channex.feed = [];
    written = [];

    await cycle();

    expect(await dataSource.query(`SELECT status FROM reservation`)).toEqual([
      { status: 'NO_SHOW' },
    ]);
    expect(
      await dataSource.query(`SELECT result, attempts FROM ota_no_show_report`),
    ).toEqual([{ result: 'PENDING', attempts: 1 }]);
    for (const secret of SECRETS) {
      expect(allLogs(), `el log tiene "${secret}"`).not.toContain(secret);
    }
  });
});
