import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import type { RoomQuote } from '../../../src/application/integration/room-quote.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  GET_REFERENCE_RATES,
  type GetReferenceRates,
} from '../../../src/application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';
import { PUBLISH_PENDING_DAILY_MESSAGES } from '../../../src/application/use-cases/check-view-reservation/ports/in/publish-pending-daily-messages.port.js';
import { configureApp } from '../../../src/configure-app.js';
import { PublishPendingJob } from '../../../src/infrastructure/in/jobs/publish-pending.job.js';
import type { ReferenceRate } from '../../../src/domain/rate/reference-rate.js';
import type { RoomRate } from '../../../src/domain/reservation/reservation-room.js';
import { aDirectReservation } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/** Los Módulos 1 y 3, en direcciones propias de la prueba: toda llamada a ellas queda anotada. */
const MODULE1_BASE_URL = 'http://module1.test';
const MODULE3_BASE_URL = 'http://module3.test';

/** La configuración del ejemplo de C1. */
const RATE_REFERENCE = {
  seasonAdjustmentPercentage: '15.00',
  currency: 'COP',
  baseRates: { DOBLE: '220000.00', SUITE: '480000.00' },
};

const server = setupServer();

/**
 * T019 de `calculate-dynamic-rate` (FR-009; plan, C): la pantalla "Tarifas" es local. Con la aplicación
 * completa (`AppModule`), la configuración `RATE_REFERENCE` del ejemplo de C1 y PostgreSQL real, se
 * comprueba que `GET /api/rates/reference`:
 * - no llama al Módulo 3 ni al Módulo 1;
 * - no escribe nada: ni siquiera consulta la base;
 * - no devuelve nada que se pueda usar como la cotización de una habitación (`RoomQuote`).
 */
describe('calculate-dynamic-rate: la referencia de tarifas no llama al Módulo 3, no escribe nada y no es una cotización (T019, FR-009)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  /** Las llamadas HTTP a los Módulos 1 y 3 durante la prueba. */
  let callsToOtherModules: string[];

  const reference = () =>
    request(app.getHttpServer()).get('/api/rates/reference').expect(200);

  /** Cuántas filas tiene cada tabla. */
  async function rowCounts(): Promise<Record<string, number>> {
    const tables: { tablename: string }[] = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const counts: Record<string, number> = {};
    for (const { tablename } of tables) {
      const [row]: { total: number }[] = await dataSource.query(
        `SELECT count(*)::int AS total FROM "${tablename}"`,
      );
      counts[tablename] = row.total;
    }
    return counts;
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, {
      NODE_ENV: 'test',
      ...integrationEnv(),
      MODULE1_BASE_URL,
      MODULE3_BASE_URL,
      RATE_REFERENCE: JSON.stringify(RATE_REFERENCE),
    });
    // Lo que no va a los otros módulos (la propia aplicación, la base) pasa sin tocarse.
    server.listen({
      onUnhandledRequest: (sent) => {
        const { origin } = new URL(sent.url);
        if (origin === MODULE1_BASE_URL || origin === MODULE3_BASE_URL) {
          callsToOtherModules.push(sent.url);
        }
      },
    });
    callsToOtherModules = [];
    const { AppModule } = await import('../../../src/app.module.js');
    // La publicación de la lista del día consulta la base por su cuenta: la tarea de cada 10 s
    // (`PublishPendingJob`) y la inmediata, que sale después de generar la lista al arrancar. Apagadas, la
    // única consulta que podría ver el espía de abajo sería la de la referencia de tarifas.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PublishPendingJob)
      .useValue({})
      .overrideProvider(PUBLISH_PENDING_DAILY_MESSAGES)
      .useValue({ execute: () => Promise.resolve(0) })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    await truncateAllTables(dataSource);
    // Una reserva guardada: la base no está vacía, así que un cambio se notaría.
    await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation());
  });

  beforeEach(() => {
    callsToOtherModules = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.close();
    await truncateAllTables(dataSource);
    await app?.close();
    delete process.env.MODULE1_BASE_URL;
    delete process.env.MODULE3_BASE_URL;
    delete process.env.RATE_REFERENCE;
  });

  it('responde el ejemplo de C1 con la tarifa efectiva calculada, sin ninguna llamada al Módulo 3 ni al Módulo 1', async () => {
    const res = await reference();

    expect(res.body).toEqual({
      items: [
        {
          categoryRoom: 'DOBLE',
          baseRate: { amount: '220000.00', currency: 'COP' },
          seasonAdjustmentPercentage: '15.00',
          effectiveRate: { amount: '253000.00', currency: 'COP' },
        },
        {
          categoryRoom: 'SUITE',
          baseRate: { amount: '480000.00', currency: 'COP' },
          seasonAdjustmentPercentage: '15.00',
          effectiveRate: { amount: '552000.00', currency: 'COP' },
        },
      ],
      note: 'Referencia ilustrativa. La tarifa real se obtiene al cotizar.',
    });
    expect(callsToOtherModules).toEqual([]);
  });

  it('el espía sí ve una llamada al Módulo 3: la comprobación anterior no pasa por descuido', async () => {
    await fetch(`${MODULE3_BASE_URL}/pricing/quotes`).catch(() => undefined);

    expect(callsToOtherModules).toEqual([`${MODULE3_BASE_URL}/pricing/quotes`]);
  });

  it('no escribe nada: las tablas quedan con las mismas filas y la base ni siquiera se consulta', async () => {
    const before = await rowCounts();
    const query = vi.spyOn(dataSource, 'query');
    const createQueryRunner = vi.spyOn(dataSource, 'createQueryRunner');

    await reference();
    await reference();

    expect(query).not.toHaveBeenCalled();
    expect(createQueryRunner).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await rowCounts()).toEqual(before);
    expect(before.reservation).toBe(1);
  });

  describe('no es convertible a RoomQuote: no sirve como la tarifa de una habitación', () => {
    it('ninguna fila trae los campos de una cotización (quoteId, nightlyRates, lodgingAmount ni key)', async () => {
      const res = await reference();

      const { items } = res.body as { items: Record<string, unknown>[] };
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual([
          'baseRate',
          'categoryRoom',
          'effectiveRate',
          'seasonAdjustmentPercentage',
        ]);
      }
      expect(JSON.stringify(res.body)).not.toMatch(
        /quoteId|nightlyRates|lodgingAmount|roomGrossAmount/,
      );
    });

    it('el caso de uso devuelve ReferenceRate, un tipo que no encaja en RoomQuote ni en la tarifa de una habitación', () => {
      const [rate] = app.get<GetReferenceRates>(GET_REFERENCE_RATES).execute();

      // En tiempo de compilación (`pnpm typecheck`): si alguien agrega los campos que faltan, esto falla.
      expectTypeOf<ReferenceRate>().not.toMatchTypeOf<RoomQuote>();
      expectTypeOf<ReferenceRate>().not.toMatchTypeOf<RoomRate>();
      // @ts-expect-error Una tarifa de referencia no se puede asignar a una cotización.
      const asQuote: RoomQuote = rate;
      // @ts-expect-error Ni a la tarifa que guarda una habitación de la reserva.
      const asRoomRate: RoomRate = rate;

      // En tiempo de ejecución: le faltan el `quoteId` y el importe de la estadía.
      expect(asQuote).not.toHaveProperty('quoteId');
      expect(asQuote).not.toHaveProperty('lodgingAmount');
      expect(asRoomRate).not.toHaveProperty('roomGrossAmount');
    });
  });
});
