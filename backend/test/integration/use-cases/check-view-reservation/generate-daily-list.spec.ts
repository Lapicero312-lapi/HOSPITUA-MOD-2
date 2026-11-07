import { Test, type TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../../../src/application/ports/out/clock.js';
import { DailyListChangeRecorderService } from '../../../../src/application/use-cases/check-view-reservation/daily-list-change-recorder.service.js';
import { GenerateDailyListService } from '../../../../src/application/use-cases/check-view-reservation/generate-daily-list.service.js';
import { GENERATE_DAILY_LIST } from '../../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { TypeOrmDailyMessageRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-message.repository.js';
import { TypeOrmDailySequenceRepository } from '../../../../src/infrastructure/out/persistence/repositories/daily-sequence.repository.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationQuery } from '../../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** El día operativo del ejemplo de "Lista del día" del plan, a las 00:00:02 de Colombia. */
const TODAY = '2026-10-09';
const CLOCK: Clock = {
  today: () => TODAY,
  now: () => new Date('2026-10-09T05:00:02.000Z'),
};

type ListPayload = {
  operationalDate: string;
  generatedAt: string;
  totalReservations: number;
  totalRooms: number;
  totalGuests: number;
  reservations: {
    reservationRef: string;
    source: string;
    updatedAt: string;
  }[];
};

type MessageRow = {
  operational_date: string;
  sequence_number: number;
  message_kind: string;
  update_type: string | null;
  reservation_id: string | null;
  publish_status: string;
  attempts: number;
  payload: ListPayload | { reservationRef: string };
};

/**
 * `GenerateDailyList` con los repositorios reales (plan de `check-view-reservation`, "Generar la lista del
 * día", D2 y "Por qué hace falta `daily_sequence`").
 */
describe('GenerateDailyList contra PostgreSQL real (T023)', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let sequences: TypeOrmDailySequenceRepository;
  let query: TypeOrmReservationQuery;
  let transactions: TypeOrmTransactionRunner;
  let generator: GenerateDailyListService;
  let recorder: DailyListChangeRecorderService;

  const arriving = (day = TODAY, changes = {}) =>
    aDirectReservation({ startDate: day, endDate: '2026-10-12', ...changes });

  /** Crea la reserva y anota el cambio en una sola transacción, como `generate-direct-reservation`. */
  const create = (reservation: Reservation, day = TODAY) =>
    transactions.run(async (tx) => {
      const saved = await reservations.insert(reservation, tx);
      await recorder.record(tx, null, saved, day);
      return saved;
    });

  const messages = (): Promise<MessageRow[]> =>
    dataSource.query(
      `SELECT to_char(operational_date, 'YYYY-MM-DD') AS operational_date, sequence_number, message_kind,
              update_type, reservation_id::text, publish_status, attempts, payload
       FROM daily_list_message ORDER BY operational_date, sequence_number`,
    );

  const dayRow = async (day = TODAY) => {
    const rows: { last_sequence: number; list_generated: boolean }[] =
      await dataSource.query(
        'SELECT last_sequence, list_generated FROM daily_sequence WHERE operational_date = $1',
        [day],
      );
    return rows[0];
  };

  const listOf = async (day = TODAY): Promise<ListPayload> => {
    const list = (await messages()).find(
      (row) => row.message_kind === 'LIST' && row.operational_date === day,
    );
    if (list === undefined) {
      throw new Error(`No hay lista del ${day}.`);
    }
    return list.payload as ListPayload;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    sequences = new TypeOrmDailySequenceRepository(dataSource);
    query = new TypeOrmReservationQuery(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
    const messageRepository = new TypeOrmDailyMessageRepository(dataSource);
    generator = new GenerateDailyListService(
      transactions,
      sequences,
      query,
      messageRepository,
      CLOCK,
    );
    recorder = new DailyListChangeRecorderService(
      sequences,
      messageRepository,
      new TypeOrmOtaRepository(dataSource),
      CLOCK,
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('DailySequenceRepository.lockOrCreateDay y markListGenerated', () => {
    it('crea la fila del día con 0 y false, y la siguiente vez devuelve la que hay', async () => {
      await expect(
        transactions.run((tx) => sequences.lockOrCreateDay(TODAY, tx)),
      ).resolves.toEqual({ lastSequence: 0, listGenerated: false });
      await transactions.run((tx) => sequences.markListGenerated(TODAY, tx));

      await expect(
        transactions.run((tx) => sequences.lockOrCreateDay(TODAY, tx)),
      ).resolves.toEqual({ lastSequence: 1, listGenerated: true });
      expect(await dayRow()).toEqual({
        last_sequence: 1,
        list_generated: true,
      });
    });

    it('dos que la crean a la vez no chocan: queda una sola fila', async () => {
      await Promise.all([
        transactions.run((tx) => sequences.lockOrCreateDay(TODAY, tx)),
        transactions.run((tx) => sequences.lockOrCreateDay(TODAY, tx)),
      ]);

      const [{ total }]: { total: number }[] = await dataSource.query(
        'SELECT count(*)::int AS total FROM daily_sequence',
      );
      expect(total).toBe(1);
    });

    it('si la transacción se revierte, la fila creada tampoco queda', async () => {
      await transactions
        .run(async (tx) => {
          await sequences.lockOrCreateDay(TODAY, tx);
          throw new Error('falla después');
        })
        .catch(() => undefined);

      expect(await dayRow()).toBeUndefined();
    });
  });

  describe('ReservationQueryPort.findArrivals', () => {
    it('trae solo las ACTIVE que llegan ese día, completas, con su agencia y por reservationRef', async () => {
      const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
      const direct = await reservations.insert(
        arriving(TODAY, { reservationRef: 'RSV-0000000B' }),
      );
      const fromBooking = await reservations.insert(
        anOtaReservation(ota.id, {
          reservationRef: 'RSV-0000000A',
          startDate: TODAY,
          endDate: '2026-10-11',
        }),
      );
      // No llegan: otro día, PENDING de OTA o cancelada.
      await reservations.insert(arriving('2026-10-10'));
      await reservations.insert(
        anOtaReservation(ota.id, {
          startDate: TODAY,
          status: 'PENDING',
          ota: { ...fromBooking.ota!, externalConfirmationCode: '999' },
        }),
      );
      await reservations.insert(
        arriving(TODAY, {
          status: 'CANCELLED',
          statusReason: 'CANCELLED_BY_RECEPTION',
        }),
      );

      const arrivals = await transactions.run((tx) =>
        query.findArrivals(TODAY, tx),
      );

      expect(
        arrivals.map(({ reservation, otaName }) => [
          reservation.reservationRef,
          otaName,
        ]),
      ).toEqual([
        ['RSV-0000000A', 'Booking.com'],
        ['RSV-0000000B', null],
      ]);
      expect(arrivals[1].reservation.rooms).toHaveLength(direct.rooms.length);
      expect(arrivals[1].reservation.guest.firstName).toBe('Valentina');
      expect(arrivals[1].reservation.updatedAt).toBe(direct.updatedAt);
    });
  });

  describe('execute', () => {
    it('historia 4, escenario 1: guarda la lista LIST con la secuencia 1 en PENDING y marca el día', async () => {
      const saved = await reservations.insert(arriving());

      await expect(generator.execute()).resolves.toBe(true);

      const [message] = await messages();
      expect(message).toMatchObject({
        operational_date: TODAY,
        sequence_number: 1,
        message_kind: 'LIST',
        update_type: null,
        reservation_id: null,
        publish_status: 'PENDING',
        attempts: 0,
      });
      const list = message.payload as ListPayload;
      expect(list).toMatchObject({
        operationalDate: TODAY,
        generatedAt: '2026-10-09T00:00:02-05:00',
        totalReservations: 1,
        totalRooms: 1,
        totalGuests: 2,
      });
      expect(list.reservations[0]).toMatchObject({
        reservationRef: saved.reservationRef,
        source: 'DIRECTA',
      });
      // El updatedAt que puso la base, en hora de Colombia y con sus microsegundos.
      expect(list.reservations[0].updatedAt).toMatch(
        /^2\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}-05:00$/,
      );
      expect(await dayRow()).toEqual({
        last_sequence: 1,
        list_generated: true,
      });
    });

    it('no entran las PENDING, las de otro día, las IN_PROGRESS ni las que tienen una habitación sin asignar', async () => {
      const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
      const inList = await reservations.insert(arriving());
      await reservations.insert(arriving('2026-10-10'));
      await reservations.insert(
        anOtaReservation(ota.id, { startDate: TODAY, status: 'PENDING' }),
      );
      await reservations.insert(
        arriving(TODAY, {
          status: 'IN_PROGRESS',
          rooms: [aDirectRoom({ stayStatus: 'CHECKED_IN' })],
        }),
      );
      await reservations.insert(
        anOtaReservation(ota.id, {
          startDate: TODAY,
          rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
          ota: otaTerms(ota.id, { externalConfirmationCode: '5550001' }),
          conflict: {
            reason: 'NO_ROOM_AVAILABLE',
            detectedAt: new Date('2026-10-08T12:00:00Z'),
          },
        }),
      );

      await generator.execute();

      const list = await listOf();
      expect(list.reservations.map((r) => r.reservationRef)).toEqual([
        inList.reservationRef,
      ]);
      expect(list.totalReservations).toBe(1);
    });

    it('sin llegadas, la lista sale vacía con los tres totales en 0', async () => {
      await generator.execute();

      expect(await listOf()).toMatchObject({
        totalReservations: 0,
        totalRooms: 0,
        totalGuests: 0,
        reservations: [],
      });
    });

    it('historia 4, escenario 4: una ejecución repetida no hace nada', async () => {
      await reservations.insert(arriving());
      await generator.execute();

      await expect(generator.execute()).resolves.toBe(false);

      expect(await messages()).toHaveLength(1);
      expect(await dayRow()).toEqual({
        last_sequence: 1,
        list_generated: true,
      });
    });

    it('dos ejecuciones a la vez dejan una sola lista', async () => {
      const results = await Promise.all([
        generator.execute(),
        generator.execute(),
      ]);

      expect(results.sort()).toEqual([false, true]);
      expect(await messages()).toHaveLength(1);
    });

    it('después de la lista, un cambio toma la secuencia 2 (DailyListChangeRecorder)', async () => {
      await generator.execute();

      const saved = await create(arriving());

      expect(
        (await messages()).map((row) => [
          row.sequence_number,
          row.message_kind,
          row.update_type,
          row.reservation_id,
        ]),
      ).toEqual([
        [1, 'LIST', null, null],
        [2, 'UPDATE', 'ADDED', saved.id],
      ]);
    });

    it('antes de la lista, un cambio no deja aviso y la reserva entra en la lista con los datos vigentes', async () => {
      const saved = await create(arriving());

      await generator.execute();

      const rows = await messages();
      expect(rows).toHaveLength(1);
      expect(
        (rows[0].payload as ListPayload).reservations.map(
          (r) => r.reservationRef,
        ),
      ).toEqual([saved.reservationRef]);
    });

    it('una reserva creada justo cuando sale la lista queda en la lista o en su ADDED, nunca en las dos ni en ninguna', async () => {
      // Varios días, para que la carrera se resuelva de las dos maneras.
      const days = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'];
      for (const day of days) {
        const [, saved] = await Promise.all([
          generator.execute(day),
          create(arriving(day, { endDate: '2026-10-20' }), day),
        ]);

        const rows = (await messages()).filter(
          (row) => row.operational_date === day,
        );
        const inList = (await listOf(day)).reservations.some(
          (r) => r.reservationRef === saved.reservationRef,
        );
        const added = rows.filter((row) => row.update_type === 'ADDED');
        expect(Number(inList) + added.length).toBe(1);
        expect(rows.map((row) => row.sequence_number)).toEqual(
          inList ? [1] : [1, 2],
        );
      }
    });

    it('si la transacción se revierte no queda ni la lista ni la marca del día', async () => {
      const failing = new GenerateDailyListService(
        transactions,
        sequences,
        query,
        {
          insert: () => Promise.reject(new Error('se cayó la conexión')),
        },
        CLOCK,
      );

      await expect(failing.execute()).rejects.toThrow('se cayó la conexión');

      expect(await messages()).toEqual([]);
      expect(await dayRow()).toBeUndefined();
    });
  });
});

/** Un proveedor de fuera del módulo lo inyecta, como lo hará la tarea de las 00:00 (T024). */
const INJECTED_GENERATOR = Symbol('INJECTED_GENERATOR');

describe('CheckViewReservationModule exporta GenerateDailyList', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { CheckViewReservationModule } =
      await import('../../../../src/application/use-cases/check-view-reservation/check-view-reservation.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        CheckViewReservationModule,
      ],
      providers: [
        {
          provide: INJECTED_GENERATOR,
          inject: [GENERATE_DAILY_LIST],
          useFactory: (generator: unknown) => generator,
        },
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('con sus repositorios de PersistenceModule, el TransactionRunner y el reloj', () => {
    expect(moduleRef?.get(INJECTED_GENERATOR)).toBeInstanceOf(
      GenerateDailyListService,
    );
  });
});
