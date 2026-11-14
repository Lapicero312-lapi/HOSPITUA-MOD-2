import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Room } from '../../../../src/application/integration/room.js';
import {
  CLOCK,
  type Clock,
} from '../../../../src/application/ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../src/application/ports/out/reservation.repository.js';
import type { GuestPayload } from '../../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import {
  CLOSE_DAY,
  type CloseDay,
} from '../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import {
  PREVIEW_MODIFICATION,
  type PreviewModification,
} from '../../../../src/application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import {
  PROCESS_CHECK_IN,
  type ProcessCheckIn,
} from '../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import type { EnvironmentVariables } from '../../../../src/infrastructure/config/env.validation.js';
import { INBOUND_QUEUES } from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { CloseDayJob } from '../../../../src/infrastructure/in/jobs/close-day.job.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/**
 * Pruebas de tiempo de `update-reservation` (T030), con las condiciones del plan ("Pruebas por escenario"):
 * - NFR-001: la vista previa de una reserva de 10 habitaciones que cambia las fechas, con el Módulo 1 a
 *   150 ms y el Módulo 3 a 300 ms, en menos de 3 s;
 * - NFR-002: el Check-In de una habitación con 10 huéspedes en menos de 500 ms;
 * - NFR-003: el cierre del día de 1000 reservas en menos de 1 minuto.
 *
 * La aplicación completa (`AppModule`) con PostgreSQL y RabbitMQ reales. Los Módulos 1 y 3 se simulan en
 * HTTP (msw) con su retraso, así que sus clientes, sus topes de concurrencia y la configuración son los
 * reales. Las 1000 reservas del cierre se cargan con SQL, porque son datos de la prueba: lo que se mide es
 * el código de producción.
 */

const RECALCULATION_LIMIT_MS = 3000;
const CHECK_IN_LIMIT_MS = 500;
const CLOSE_DAY_LIMIT_MS = 60_000;

/** Los retrasos de las pruebas de tiempo de `check-room-availability` y `calculate-dynamic-rate`. */
const MODULE1_DELAY_MS = 150;
const MODULE3_DELAY_MS = 300;

/** Un día operativo de 2037, propio de esta prueba. */
const TODAY = '2037-03-01';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2037-03-01T15:00:00.000Z'),
};

/** 10 habitaciones `DOBLE` del Módulo 1, de la 401 a la 410. */
const ROOMS: Room[] = Array.from({ length: 10 }, (_, index) => ({
  id: randomUUID(),
  roomNumber: String(401 + index),
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
}));

/** Diez huéspedes en una habitación: cinco extranjeros y cinco colombianos. */
const TEN_GUESTS: GuestPayload[] = Array.from({ length: 10 }, (_, index) => ({
  firstName: `Huésped ${index}`,
  lastName: 'Tiempo',
  documentType: index % 2 === 0 ? 'PAS' : 'CC',
  documentNumber: `T${String(index).padStart(3, '0')}`,
  birthDate: '1990-05-12',
  nationality: index % 2 === 0 ? 'Estados Unidos' : 'Colombia',
  ...(index % 2 === 0
    ? {
        originPlace: 'Miami, Estados Unidos',
        destinationPlace: 'Cartagena, Colombia',
      }
    : {}),
}));

const server = setupServer();

/** Cuánto tarda `work`, en milisegundos. */
async function timed(work: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

describe('update-reservation: tiempos (T030, NFR-001 a NFR-003)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
  /** Lo que recibió cada módulo simulado. */
  const calls = { module1: 0, module3: 0 };

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../../src/app.module.js');
    // La aplicación completa también llama a Channex al arrancar, y esta prueba no lo simula.
    server.listen({ onUnhandledRequest: 'bypass' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      // Con el reloj fijo, el cierre del día no corre al arrancar: lo que se mide es la llamada de la prueba.
      .overrideProvider(CloseDayJob)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = app.get(DataSource);
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);

    const config =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    const module1 = config.get('MODULE1_BASE_URL', { infer: true });
    const module3 = config.get('MODULE3_BASE_URL', { infer: true });
    let quoteNumber = 0;
    server.use(
      http.get(`${module1}/api/rooms/:roomId`, async ({ params }) => {
        calls.module1 += 1;
        await delay(MODULE1_DELAY_MS);
        return HttpResponse.json(ROOMS.find(({ id }) => id === params.roomId));
      }),
      http.get(
        `${module1}/api/rooms/:roomId/maintenances`,
        async ({ params }) => {
          calls.module1 += 1;
          await delay(MODULE1_DELAY_MS);
          return HttpResponse.json({
            roomId: params.roomId,
            available: true,
            conflicts: [],
          });
        },
      ),
      http.post(`${module3}/pricing/quotes`, async ({ request }) => {
        calls.module3 += 1;
        quoteNumber += 1;
        const quoteId = `00000000-0000-4000-8000-${String(quoteNumber).padStart(12, '0')}`;
        const { checkInDate } = (await request.json()) as {
          checkInDate: string;
        };
        await delay(MODULE3_DELAY_MS);
        return HttpResponse.json({
          quoteId,
          currency: 'COP',
          nightlyRates: [0, 1].map((night) => {
            const day = new Date(`${checkInDate}T00:00:00Z`);
            day.setUTCDate(day.getUTCDate() + night);
            return { date: day.toISOString().slice(0, 10), rate: '250000.00' };
          }),
          lodgingAmount: '500000.00',
        });
      }),
    );
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    server.close();
    await app?.close();
  });

  it(`NFR-001: la vista previa de 10 habitaciones con fechas nuevas, con el Módulo 1 a ${MODULE1_DELAY_MS} ms y el Módulo 3 a ${MODULE3_DELAY_MS} ms, en menos de 3 s`, async () => {
    const reservation = await reservations.insert(
      aDirectReservation({
        startDate: '2037-03-10',
        endDate: '2037-03-12',
        rooms: ROOMS.map((room) =>
          aDirectRoom({
            roomId: room.id,
            roomNumber: room.roomNumber,
            categoryRoom: 'DOBLE',
            guestCount: 1,
            rate: {
              roomGrossAmount: Money.of('500000.00', 'COP'),
              quoteId: `Q-${room.roomNumber}`,
            },
          }),
        ),
      }),
    );
    const preview = app.get<PreviewModification>(PREVIEW_MODIFICATION);
    calls.module1 = 0;
    calls.module3 = 0;

    let quoted = 0;
    const elapsed = await timed(async () => {
      const result = await preview.execute(reservation.reservationRef, {
        updatedAt: reservation.updatedAt,
        startDate: '2037-03-11',
        endDate: '2037-03-13',
        rooms: ROOMS.map(({ id }) => ({ roomId: id, guestCount: 1 })),
      });
      quoted = result.quotes?.quotes.length ?? 0;
    });

    // Se recotizaron las 10 y se consultó de verdad a los dos módulos simulados.
    expect(quoted).toBe(10);
    expect(calls.module3).toBe(10);
    expect(calls.module1).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(RECALCULATION_LIMIT_MS);
  });

  it('NFR-002: el Check-In de una habitación con 10 huéspedes en menos de 500 ms', async () => {
    const [room] = ROOMS;
    const reservation = await reservations.insert(
      aDirectReservation({
        startDate: TODAY,
        endDate: '2037-03-03',
        rooms: [
          aDirectRoom({
            roomId: room.id,
            roomNumber: room.roomNumber,
            categoryRoom: 'DOBLE',
            guestCount: 2,
          }),
        ],
      }),
    );
    const checkIn = app.get<ProcessCheckIn>(PROCESS_CHECK_IN);

    let outcome = '';
    const elapsed = await timed(async () => {
      outcome = await checkIn.execute({
        messageId: randomUUID(),
        sequenceNumber: 1,
        queue: INBOUND_QUEUES.CHECK_IN.name,
        reservationRef: reservation.reservationRef,
        roomId: room.id,
        movementDate: TODAY,
        guests: TEN_GUESTS,
      });
    });

    expect(outcome).toBe('APPLIED');
    // Los diez huéspedes registraron su movimiento de entrada (process-guest-data).
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM migratory_movement',
    );
    expect(total).toBe(10);
    expect(elapsed).toBeLessThan(CHECK_IN_LIMIT_MS);
  });

  it('NFR-003: el cierre del día de 1000 reservas en menos de 1 minuto', async () => {
    const day = '2037-02-20';
    // 1000 reservas directas ACTIVE que llegaban `day`, cada una en una habitación distinta.
    await dataSource.query(
      `WITH created AS (
         INSERT INTO reservation (reservation_ref, source, start_date, end_date, guest_count, status)
         SELECT 'RSV-' || upper(lpad(to_hex(n), 8, '0')), 'DIRECT', $1::date, $1::date + 2, 1, 'ACTIVE'
         FROM generate_series(1, 1000) AS n
         RETURNING id, reservation_ref
       ), holders AS (
         INSERT INTO guest (reservation_id, first_name, last_name, document_type, document_number, nationality)
         SELECT id, 'Huésped', 'Tiempo', 'CC', reservation_ref, 'Colombia' FROM created
       )
       INSERT INTO reservation_room (reservation_id, room_id, room_number, category_room, guest_count,
                                     room_gross_amount, quote_id, currency, stay_status, start_date, end_date,
                                     blocks_inventory)
       SELECT id, gen_random_uuid(), '101', 'DOBLE', 1, 500000, 'Q-' || reservation_ref, 'COP', 'EXPECTED',
              $1::date, $1::date + 2, true
       FROM created`,
      [day],
    );
    await dataSource.query('ANALYZE');
    const close = app.get<CloseDay>(CLOSE_DAY);

    let noShow = 0;
    const elapsed = await timed(async () => {
      noShow = (await close.execute(day)).noShow;
    });

    expect(noShow).toBe(1000);
    expect(elapsed).toBeLessThan(CLOSE_DAY_LIMIT_MS);
  }, 120_000);
});
