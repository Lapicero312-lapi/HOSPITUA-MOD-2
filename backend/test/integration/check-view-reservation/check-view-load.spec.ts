import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import { configureApp } from '../../../src/configure-app.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T036 de `check-view-reservation`: la prueba de carga.
 * - NFR-001: la búsqueda por código responde en menos de 500 ms (plan, trazabilidad: T001, T002 y T036).
 * - NFR-002: "una página del listado, con cualquier combinación de filtros y cualquier orden, debe
 *   responder en menos de 1 segundo con hasta 50 000 reservas registradas".
 * - NFR-004: "la lista del día debe quedar publicada en menos de 1 minuto desde las 00:00 del día
 *   operativo, con hasta 500 reservas".
 *
 * La aplicación completa, con PostgreSQL y RabbitMQ reales. Cada medición se hace después de una
 * consulta igual que no se mide, porque la primera conexión no es la condición normal.
 */

/** El día operativo con el que arranca la aplicación (su lista se genera al arrancar, vacía). */
const BOOT_DAY = '2033-01-01';
/** El día de las 500 llegadas: su lista se genera y se publica en la prueba. */
const ARRIVALS_DAY = '2033-02-01';
const clock: Clock = {
  today: () => BOOT_DAY,
  now: () => new Date('2033-01-01T05:00:30.000Z'),
};

const RESERVATIONS = 50_000;
const ARRIVALS = 500;
const PAGE_LIMIT_MS = 1_000;
const CODE_SEARCH_LIMIT_MS = 500;
const LIST_LIMIT_MS = 60_000;

const server = setupServer();

describe('Consultar reservas: prueba de carga (T036, NFR-002 y NFR-004)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  /** Cuánto tarda `work`, en milisegundos. */
  async function timed<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; elapsed: number }> {
    const start = performance.now();
    const result = await work();
    return { result, elapsed: performance.now() - start };
  }

  /**
   * `count` reservas desde `firstDay`, de a `perDay` por día de llegada y de dos noches, con su titular y una
   * habitación; una de cada 10 `PENDING` y una de cada 10 `CANCELLED`.
   */
  async function load(
    count: number,
    firstDay: string,
    perDay: number,
    prefix: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO reservation
         (id, reservation_ref, source, start_date, end_date, guest_count, status, status_reason)
       SELECT gen_random_uuid(), 'RSV-' || $4::text || upper(lpad(to_hex(g), 7, '0')), 'DIRECT',
              $2::date + (g / $3::int), $2::date + (g / $3::int) + 2, 2,
              CASE WHEN g % 10 = 9 THEN 'CANCELLED' WHEN g % 10 = 8 THEN 'PENDING' ELSE 'ACTIVE' END,
              CASE WHEN g % 10 = 9 THEN 'CANCELLED_BY_RECEPTION' END
       FROM generate_series(0, $1::int - 1) AS g`,
      [count, firstDay, perDay, prefix],
    );
    await dataSource.query(
      `INSERT INTO guest
         (id, reservation_id, first_name, last_name, document_type, document_number, nationality)
       SELECT gen_random_uuid(), r.id, 'Nombre ' || right(r.reservation_ref, 4), 'Apellido', 'CC',
              substring(r.reservation_ref FROM 5), 'Colombia'
       FROM reservation r WHERE r.reservation_ref LIKE 'RSV-' || $1::text || '%'`,
      [prefix],
    );
    await dataSource.query(
      `INSERT INTO reservation_room
         (id, reservation_id, room_id, room_number, category_room, guest_count, room_gross_amount,
          quote_id, currency, stay_status, start_date, end_date, blocks_inventory)
       SELECT gen_random_uuid(), r.id, gen_random_uuid(), lpad((row_number() OVER ())::text, 4, '0'),
              'DOBLE', 2, 530000, 'Q-' || r.reservation_ref, 'COP', 'EXPECTED', r.start_date, r.end_date,
              r.status IN ('ACTIVE', 'PENDING')
       FROM reservation r WHERE r.reservation_ref LIKE 'RSV-' || $1::text || '%'`,
      [prefix],
    );
    await dataSource.query('ANALYZE reservation, reservation_room, guest');
  }

  const list = (query: Record<string, string>) =>
    request(app.getHttpServer())
      .get('/api/reservations')
      .set('X-Client', 'RECEPTIONIST')
      .query(query);

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    // La aplicación completa también llama a Channex al arrancar, y esta prueba no lo simula.
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    await truncateAllTables(dataSource);
    // 50 000 reservas desde 2027, 20 por día de llegada: unos 7 años de llegadas.
    await load(RESERVATIONS, '2027-01-01', 20, 'A');
  }, 300_000);

  afterAll(async () => {
    // Las 50 000 reservas no se dejan en la base: la siguiente prueba que arranca la aplicación completa
    // con un día posterior tendría que cerrarlas todas en la recuperación del cierre del día (T022) antes de
    // terminar de arrancar.
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    server.close();
    await app?.close();
  });

  it(`la base tiene las ${RESERVATIONS} reservas`, async () => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM reservation',
    );
    expect(total).toBe(RESERVATIONS);
  });

  it.each<[string, Record<string, string>]>([
    ['sin filtros, la primera página', {}],
    [
      'sin filtros, la última página, en orden ascendente',
      { page: '5000', order: 'asc' },
    ],
    ['por estado', { status: 'PENDING' }],
    ['por canal', { source: 'DIRECT' }],
    ['por estadía de un mes', { dateFrom: '2030-06-01', dateTo: '2030-06-30' }],
    [
      'estado, canal y estadía combinados',
      {
        status: 'ACTIVE',
        source: 'DIRECT',
        dateFrom: '2029-01-01',
        dateTo: '2029-12-31',
      },
    ],
    ['en conflicto', { inConflict: 'true' }],
  ])(
    `NFR-002: %s responde en menos de ${PAGE_LIMIT_MS / 1000} s`,
    async (_, query) => {
      await list(query).expect(200);

      const { result: res, elapsed } = await timed(() => list(query));

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(PAGE_LIMIT_MS);
    },
  );

  it('el orden ascendente sí se aplica: la última página trae las llegadas más recientes', async () => {
    const asc = await list({ page: '5000', order: 'asc' }).expect(200);
    const desc = await list({ page: '1' }).expect(200);

    // La última página en ascendente es la primera en descendente, en orden inverso.
    expect(asc.body.items.at(-1).reservationRef).toBe(
      desc.body.items[0].reservationRef,
    );
  });

  it(`NFR-001: la búsqueda por código responde en menos de ${CODE_SEARCH_LIMIT_MS} ms`, async () => {
    const query = { search: 'RSV-A0003039' };
    await list(query).expect(200);

    const { result: res, elapsed } = await timed(() => list(query));

    expect(res.body.totalItems).toBe(1);
    expect(elapsed).toBeLessThan(CODE_SEARCH_LIMIT_MS);
  });

  it.each<[string, Record<string, string>, number]>([
    ['por documento exacto', { search: 'A0003039' }, 1],
    [
      'por nombre parcial, que coincide con todas',
      { search: 'Apellido' },
      RESERVATIONS,
    ],
    [
      'por nombre, combinada con estado y estadía',
      {
        search: 'apellido',
        status: 'ACTIVE',
        dateFrom: '2029-01-01',
        dateTo: '2029-12-31',
      },
      -1,
    ],
  ])(
    `NFR-002: la búsqueda %s responde en menos de ${PAGE_LIMIT_MS / 1000} s`,
    async (_, query, total) => {
      await list(query).expect(200);

      const { result: res, elapsed } = await timed(() => list(query));

      expect(res.status).toBe(200);
      if (total >= 0) {
        expect(res.body.totalItems).toBe(total);
      } else {
        expect(res.body.totalItems).toBeGreaterThan(0);
      }
      expect(elapsed).toBeLessThan(PAGE_LIMIT_MS);
    },
  );

  it(`NFR-004: con ${ARRIVALS} llegadas, la lista del día queda generada y publicada en RabbitMQ en menos de ${LIST_LIMIT_MS / 1000} s`, async () => {
    await load(ARRIVALS, ARRIVALS_DAY, ARRIVALS, 'B');
    const generator = app.get<GenerateDailyList>(GENERATE_DAILY_LIST);
    const listMessage = async () => {
      const [message]: {
        publish_status: string;
        total: number;
      }[] = await dataSource.query(
        `SELECT publish_status, (payload->>'totalReservations')::int AS total
         FROM daily_list_message WHERE operational_date = $1 AND message_kind = 'LIST'`,
        [ARRIVALS_DAY],
      );
      return message;
    };

    // Generar la lista dispara su publicación (T029): se mide hasta que queda PUBLISHED, no lo que devuelva
    // una publicación aparte, que puede encontrar el bloqueo tomado o la lista ya publicada.
    const { elapsed } = await timed(async () => {
      await generator.execute(ARRIVALS_DAY);
      await vi.waitFor(
        async () => {
          expect((await listMessage())?.publish_status).toBe('PUBLISHED');
        },
        { timeout: LIST_LIMIT_MS, interval: 50 },
      );
    });

    expect(elapsed).toBeLessThan(LIST_LIMIT_MS);
    const message = await listMessage();
    // Solo van las ACTIVE de ese día (`DailyListMembership.belongs`): 8 de cada 10 de las 500, más las de
    // las 50 000 que también llegan ese día.
    const [{ active }]: { active: number }[] = await dataSource.query(
      `SELECT count(*)::int AS active FROM reservation WHERE status = 'ACTIVE' AND start_date = $1`,
      [ARRIVALS_DAY],
    );
    expect(active).toBeGreaterThanOrEqual((ARRIVALS * 8) / 10);
    expect(message).toEqual({ publish_status: 'PUBLISHED', total: active });
  }, 120_000);
});
