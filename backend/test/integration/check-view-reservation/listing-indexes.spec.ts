import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import { configureApp } from '../../../src/configure-app.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aGuest,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/** Una consulta que la aplicación mandó a PostgreSQL, con sus parámetros. */
type SentQuery = { sql: string; params: unknown[] };

/**
 * T002 de `check-view-reservation` (NFR-001 y NFR-002): el listado, la búsqueda por código y la búsqueda por
 * titular usan los índices de "Datos y consultas" ("Índices y extensiones"). Se captura el SQL exacto que
 * manda `GET /api/reservations` y se le pide el plan a PostgreSQL con `EXPLAIN` y `enable_seqscan = off`:
 * con pocas filas el planificador prefiere recorrer la tabla, así que apagarlo muestra si la consulta **puede**
 * usar el índice. Si la expresión no coincide con la del índice (por ejemplo, `lower(reservation_ref)` contra
 * un índice sobre `reservation_ref`), no puede ni así y el plan trae un `Seq Scan`. La aplicación completa y
 * PostgreSQL con las migraciones reales.
 */
describe('check-view-reservation: el listado y las búsquedas usan los índices (T002, EXPLAIN)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let direct: Reservation;
  let booking: Reservation;

  /** Las consultas que manda el listado con `query`. */
  async function queriesOf(
    query: Record<string, string>,
  ): Promise<SentQuery[]> {
    const sent: SentQuery[] = [];
    const original = dataSource.query.bind(dataSource);
    vi.spyOn(dataSource, 'query').mockImplementation(((
      sql: string,
      params?: unknown[],
    ) => {
      sent.push({ sql, params: params ?? [] });
      return original(sql, params);
    }) as typeof dataSource.query);
    await request(app.getHttpServer())
      .get('/api/reservations')
      .set('X-Client', 'RECEPTIONIST')
      .query(query);
    vi.restoreAllMocks();
    return sent.filter(({ sql }) => /\bFROM reservation r\b/.test(sql));
  }

  /** El plan de una consulta, con el recorrido completo de las tablas apagado. */
  async function planOf({ sql, params }: SentQuery): Promise<string> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query('SET LOCAL enable_seqscan = off');
      const rows: { 'QUERY PLAN': string }[] = await runner.query(
        `EXPLAIN ${sql}`,
        params,
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }

  /** Los planes de todas las consultas del listado con `query`. */
  async function plansOf(query: Record<string, string>): Promise<string[]> {
    const queries = await queriesOf(query);
    expect(queries.length).toBeGreaterThan(0);
    return Promise.all(queries.map(planOf));
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    await truncateAllTables(dataSource);
    const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    direct = await reservations.insert(
      aDirectReservation({
        guest: aGuest({
          firstName: 'María José',
          lastName: 'Gómez',
          documentNumber: '1098765432',
        }),
      }),
    );
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: 'Booking.com' }));
    booking = await reservations.insert(
      anOtaReservation(agency.id, {
        ota: otaTerms(agency.id, { externalConfirmationCode: 'BK-99812' }),
      }),
    );
    // Relleno: 3 000 reservas directas con su titular, para que el planificador elija lo que elegiría con
    // datos reales (con dos filas, cualquier recorrido le sirve).
    await dataSource.query(
      `INSERT INTO reservation
         (id, reservation_ref, source, start_date, end_date, guest_count, status)
       SELECT gen_random_uuid(), 'RSV-' || upper(lpad(to_hex(g), 8, '0')), 'DIRECT',
              DATE '2027-01-01' + g, DATE '2027-01-03' + g, 2, 'ACTIVE'
       FROM generate_series(1, 3000) AS g`,
    );
    await dataSource.query(
      `INSERT INTO guest
         (id, reservation_id, first_name, last_name, document_type, document_number, nationality)
       SELECT gen_random_uuid(), r.id, 'Nombre' || right(r.reservation_ref, 4), 'Apellido', 'CC',
              substring(r.reservation_ref FROM 5), 'Colombia'
       FROM reservation r WHERE r.start_date >= DATE '2027-01-01'`,
    );
    await dataSource.query('ANALYZE reservation, reservation_room, guest');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource !== undefined) {
      await truncateAllTables(dataSource);
    }
    await app?.close();
  });

  it.each([
    [
      'el listado por estado',
      { status: 'ACTIVE' },
      ['ix_reservation_status_start_date'],
    ],
    [
      'el listado por estadía',
      // Un mes después de todo el relleno: el cruce `end_date > dateFrom` es selectivo.
      { dateFrom: '2036-01-01', dateTo: '2036-01-31' },
      ['ix_reservation_end_date'],
    ],
    [
      'la búsqueda por la referencia',
      { search: 'RSV-3F9A1C7B' },
      [
        'uq_reservation_reservation_ref',
        'ix_reservation_external_confirmation_code_lower',
      ],
    ],
    [
      'la búsqueda por el código de la OTA',
      { search: 'BK-99812' },
      [
        'uq_reservation_reservation_ref',
        'ix_reservation_external_confirmation_code_lower',
      ],
    ],
    [
      'la búsqueda por documento',
      { search: '1098765432' },
      ['ix_guest_document_number'],
    ],
    ['la búsqueda por nombre', { search: 'gomez' }, ['ix_guest_name_trgm']],
  ])(
    '%s usa %j y nunca recorre toda la tabla reservation',
    async (_, query, indexes) => {
      const plans = (await plansOf(query)).join('\n----\n');

      for (const index of indexes) {
        expect(plans).toContain(index);
      }
      expect(plans).not.toMatch(/Seq Scan on reservation\b/);
    },
  );

  describe('la búsqueda por código con el índice sigue respondiendo lo mismo', () => {
    const refsOf = async (search: string) =>
      (
        (
          await request(app.getHttpServer())
            .get('/api/reservations')
            .set('X-Client', 'RECEPTIONIST')
            .query({ search })
        ).body as { items?: { reservationRef: string }[] }
      ).items?.map(({ reservationRef }) => reservationRef);

    it('la referencia en minúsculas y el código de la OTA en minúsculas encuentran su reserva', async () => {
      expect(await refsOf(direct.reservationRef.toLowerCase())).toEqual([
        direct.reservationRef,
      ]);
      expect(await refsOf('bk-99812')).toEqual([booking.reservationRef]);
    });

    it('un texto más largo que una referencia no la encuentra por recorte: responde que no existe', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reservations')
        .set('X-Client', 'RECEPTIONIST')
        .query({ search: `${direct.reservationRef}9` })
        .expect(400);

      expect(res.body.errorCode).toBe('RESERVATION_NOT_FOUND');
    });
  });
});
