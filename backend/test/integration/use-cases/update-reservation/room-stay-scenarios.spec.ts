import { randomUUID } from 'node:crypto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
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
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../src/application/ports/out/reservation.repository.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import type {
  ReservationStatus,
  StatusReason,
  StayStatus,
} from '../../../../src/domain/shared/enums.js';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { captureLogs } from '../../support/capture-logs.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/**
 * T019 de `update-reservation`: los escenarios 1 a 11 de la historia 2 (incluido el 3a), sus casos borde y
 * los mensajes con la forma exacta del contrato A y repetidos. Todo es real: los mensajes se publican en
 * `hospitua.events` como los envía el Módulo 1, los consumidores los toman de RabbitMQ y los aplican en
 * PostgreSQL. "Responde 400" es confirmar el mensaje sin aplicarlo y dejar el caso en el log (spec, casos
 * borde); un mensaje inutilizable va a la dead-letter.
 */

const CHECK_IN = INBOUND_QUEUES.CHECK_IN;
const CHECK_OUT = INBOUND_QUEUES.CHECK_OUT;

/** Los mensajes literales del spec que quedan en el log. */
const LOG = {
  RESERVATION_NOT_FOUND:
    'La reserva notificada no existe en el sistema de reservas.',
  ROOM_NOT_IN_RESERVATION:
    'La habitación notificada no pertenece a la reserva.',
  CHECK_IN_STATUS: 'La reserva no admite un Check-In en su estado actual.',
  RESERVATION_WITHOUT_CHECK_IN: 'La reserva aún no registra un ingreso.',
  ROOM_WITHOUT_CHECK_IN: 'La habitación notificada aún no registra un ingreso.',
};

/** Ana y John, los huéspedes del ejemplo del contrato A. */
const ANA = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};
const JOHN = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};
/** El tercero del escenario 3, de la vista de huéspedes del wireframe. */
const LUKAS = {
  firstName: 'Lukas',
  lastName: 'Becker',
  documentType: 'PAS',
  documentNumber: 'C4X8R21K',
  birthDate: '1991-07-02',
  nationality: 'Alemania',
  originPlace: 'Berlín, Alemania',
  destinationPlace: 'Medellín, Colombia',
};

const STATUS_REASON: Record<ReservationStatus, StatusReason | null> = {
  PENDING: null,
  ACTIVE: null,
  IN_PROGRESS: 'CHECK_IN',
  COMPLETED: 'CHECK_OUT',
  CANCELLED: 'CANCELLED_BY_RECEPTION',
  NO_SHOW: 'DAY_CLOSE_NO_SHOW',
};

describe('Check-In y Check-Out por la cola: escenarios 1 a 11 de la historia 2 y casos borde (T019)', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
  let logs: string[];
  /** Cada cola tiene su secuencia creciente, como el Módulo 1. */
  const sequence = { ENTRY: 100, DEPARTURE: 100 };

  /** Una reserva con las habitaciones 201, 202… en esos estados. Devuelve la reserva y sus `roomId`. */
  async function aReservation(
    status: ReservationStatus,
    stays: StayStatus[],
    dates = { startDate: '2026-10-09', endDate: '2026-10-12' },
  ): Promise<{ reservation: Reservation; rooms: string[] }> {
    const reservation = await reservations.insert(
      aDirectReservation({
        ...dates,
        status,
        statusReason: STATUS_REASON[status],
        rooms: stays.map((stayStatus, index) =>
          aDirectRoom({ roomNumber: String(201 + index), stayStatus }),
        ),
      }),
    );
    return {
      reservation,
      rooms: reservation.rooms.map((room) => room.roomId as string),
    };
  }

  /** El mensaje del contrato A, con su `messageId` nuevo y el siguiente `sequenceNumber` de su cola. */
  function aMessage(
    movementType: 'ENTRY' | 'DEPARTURE',
    reservation: Reservation,
    roomId: string,
    changes: Record<string, unknown> = {},
  ) {
    sequence[movementType] += 1;
    return {
      messageId: randomUUID(),
      sequenceNumber: sequence[movementType],
      reservationRef: reservation.reservationRef,
      roomId,
      movementType,
      movementDate: movementType === 'ENTRY' ? '2026-10-09' : '2026-10-12',
      guests: [ANA, JOHN],
      ...changes,
    };
  }

  const publish = (movementType: 'ENTRY' | 'DEPARTURE', message: unknown) =>
    connection.publish(
      EVENTS_EXCHANGE,
      (movementType === 'ENTRY' ? CHECK_IN : CHECK_OUT).routingKey,
      message,
      { persistent: true },
    );

  /** Publica y espera a que el consumidor lo confirme: aplicado o rechazado, queda en `processed_message`. */
  async function deliver(message: {
    messageId: string;
    movementType: 'ENTRY' | 'DEPARTURE';
  }): Promise<void> {
    await publish(message.movementType, message);
    await vi.waitFor(
      async () => {
        const rows: unknown[] = await dataSource.query(
          'SELECT 1 FROM processed_message WHERE message_id = $1',
          [message.messageId],
        );
        expect(rows).toHaveLength(1);
      },
      { timeout: 10_000, interval: 100 },
    );
  }

  const messageCount = async (queue: string) =>
    (await connection.channel.checkQueue(queue)).messageCount;

  const stored = async (reservation: Reservation) => {
    const current = await reservations.findById(reservation.id);
    return {
      status: current?.status,
      stays: current?.rooms.map((room) => room.stayStatus),
    };
  };

  const movementsOf = async (reservation: Reservation) => {
    const rows: {
      document_number: string;
      movement_type: string;
      movement_date: string;
    }[] = await dataSource.query(
      `SELECT gd.document_number, mm.movement_type, mm.movement_date::text AS movement_date
         FROM migratory_movement mm JOIN guest_data gd ON gd.id = mm.guest_data_id
         WHERE gd.reservation_id = $1
         ORDER BY gd.document_number, mm.movement_type`,
      [reservation.id],
    );
    return rows;
  };

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: los módulos se importan después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../../src/infrastructure/out/clock/clock.module.js');
    const { MessagingModule } =
      await import('../../../../src/infrastructure/config/messaging.module.js');
    const { ConsumersModule } =
      await import('../../../../src/infrastructure/in/messaging/consumers.module.js');
    // Los consumidores llegan a update-reservation, que importa generate-ota-reservation (CHANNEX_PORT),
    // entrega el cierre del día (CLOSE_DAY_BATCH_SIZE) y la vista previa de la modificación (los Módulos 1
    // y 3 y la tarifa de referencia): todos son globales en la aplicación.
    const { ChannexClientModule } =
      await import('../../../../src/infrastructure/out/channex/channex-client.module.js');
    const { CloseDayConfigModule } =
      await import('../../../../src/infrastructure/config/close-day.config.js');
    const { Module1ClientModule } =
      await import('../../../../src/infrastructure/out/module1/module1-client.module.js');
    const { Module3ClientModule } =
      await import('../../../../src/infrastructure/out/module3/module3-client.module.js');
    const { RateReferenceConfigModule } =
      await import('../../../../src/infrastructure/config/rate-reference.config.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        MessagingModule,
        ChannexClientModule,
        CloseDayConfigModule,
        Module1ClientModule,
        Module3ClientModule,
        RateReferenceConfigModule,
        ConsumersModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    // Los consumidores se suscriben cuando hay conexión, sin que el arranque lo espere. Se espera el log
    // "Consumiendo <cola>" de cada uno en vez de preguntarle a RabbitMQ: si se pregunta por una cola que
    // todavía no se declaró, RabbitMQ responde 404 y cierra el canal.
    const startup = captureLogs();
    await moduleRef.init();
    connection = moduleRef.get(AmqpConnection);
    dataSource = moduleRef.get(DataSource);
    reservations = moduleRef.get<ReservationRepository>(RESERVATION_REPOSITORY);
    await vi.waitFor(
      () => {
        for (const queue of [CHECK_IN.name, CHECK_OUT.name]) {
          expect(startup).toContain(`Consumiendo ${queue}`);
        }
      },
      { timeout: 15_000, interval: 100 },
    );
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    for (const queue of [CHECK_IN.name, CHECK_OUT.name]) {
      await connection.channel.purgeQueue(queue);
      await connection.channel.purgeQueue(deadLetterQueue(queue));
    }
    await truncateAllTables(dataSource);
    logs = captureLogs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('el ciclo completo de una reserva de dos habitaciones (Independent Test, escenarios 1, 2, 8 y 7)', () => {
    it('Check-In de la 201 y de la 202, Check-Out de la 201 y de la 202: IN_PROGRESS, IN_PROGRESS, IN_PROGRESS y COMPLETED', async () => {
      const { reservation, rooms } = await aReservation('ACTIVE', [
        'EXPECTED',
        'EXPECTED',
      ]);

      // Escenario 1: la primera habitación pasa la reserva a IN_PROGRESS.
      await deliver(aMessage('ENTRY', reservation, rooms[0]));
      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_IN', 'EXPECTED'],
      });

      // Escenario 2: otra habitación de la misma reserva; sigue IN_PROGRESS.
      await deliver(aMessage('ENTRY', reservation, rooms[1]));
      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_IN', 'CHECKED_IN'],
      });

      // Escenario 8: Check-Out parcial; sigue IN_PROGRESS.
      await deliver(aMessage('DEPARTURE', reservation, rooms[0]));
      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_OUT', 'CHECKED_IN'],
      });

      // Escenario 7: la última habitación pasa la reserva a COMPLETED.
      await deliver(aMessage('DEPARTURE', reservation, rooms[1]));
      expect(await stored(reservation)).toEqual({
        status: 'COMPLETED',
        stays: ['CHECKED_OUT', 'CHECKED_OUT'],
      });
    });

    it('escenario 7: la última en CHECKED_IN completa la reserva aunque otra haya quedado NOT_ARRIVED', async () => {
      const { reservation, rooms } = await aReservation('IN_PROGRESS', [
        'CHECKED_IN',
        'NOT_ARRIVED',
      ]);

      await deliver(aMessage('DEPARTURE', reservation, rooms[0]));

      expect(await stored(reservation)).toEqual({
        status: 'COMPLETED',
        stays: ['CHECKED_OUT', 'NOT_ARRIVED'],
      });
    });
  });

  it('escenarios 3 y 3a: un ENTRY por cada uno de los tres huéspedes y, al salir, un DEPARTURE por cada uno, sin tocar sus entradas', async () => {
    const { reservation, rooms } = await aReservation('ACTIVE', ['EXPECTED']);
    const guests = [ANA, JOHN, LUKAS];

    await deliver(aMessage('ENTRY', reservation, rooms[0], { guests }));
    await deliver(aMessage('DEPARTURE', reservation, rooms[0], { guests }));

    expect(await movementsOf(reservation)).toEqual([
      {
        document_number: '123',
        movement_type: 'DEPARTURE',
        movement_date: '2026-10-12',
      },
      {
        document_number: '123',
        movement_type: 'ENTRY',
        movement_date: '2026-10-09',
      },
      {
        document_number: 'C4X8R21K',
        movement_type: 'DEPARTURE',
        movement_date: '2026-10-12',
      },
      {
        document_number: 'C4X8R21K',
        movement_type: 'ENTRY',
        movement_date: '2026-10-09',
      },
      {
        document_number: 'X99',
        movement_type: 'DEPARTURE',
        movement_date: '2026-10-12',
      },
      {
        document_number: 'X99',
        movement_type: 'ENTRY',
        movement_date: '2026-10-09',
      },
    ]);
    // Solo los dos extranjeros entrarán a la exportación SIRE.
    const foreign: { total: number }[] = await dataSource.query(
      `SELECT count(*)::int AS total FROM guest_data
       WHERE reservation_id = $1 AND nationality <> 'Colombia'`,
      [reservation.id],
    );
    expect(foreign[0].total).toBe(2);
  });

  describe('los duplicados se confirman sin efectos (escenarios 4 y 11)', () => {
    it('escenario 4: el Check-In de una habitación ya CHECKED_IN no cambia nada ni duplica movimientos', async () => {
      const { reservation, rooms } = await aReservation('ACTIVE', ['EXPECTED']);
      await deliver(aMessage('ENTRY', reservation, rooms[0]));
      const before = await movementsOf(reservation);

      await deliver(aMessage('ENTRY', reservation, rooms[0]));

      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_IN'],
      });
      expect(await movementsOf(reservation)).toEqual(before);
      // Es un duplicado ("responde 200"), no un rechazo.
      expect(
        logs.some((line) =>
          line.includes(
            'la habitación ya está en CHECKED_IN y se confirma sin cambios.',
          ),
        ),
      ).toBe(true);
    });

    it('escenario 11: el Check-Out de una habitación ya CHECKED_OUT no cambia nada ni duplica movimientos', async () => {
      const { reservation, rooms } = await aReservation('ACTIVE', ['EXPECTED']);
      await deliver(aMessage('ENTRY', reservation, rooms[0]));
      await deliver(aMessage('DEPARTURE', reservation, rooms[0]));
      const before = await movementsOf(reservation);

      await deliver(aMessage('DEPARTURE', reservation, rooms[0]));

      expect(await stored(reservation)).toEqual({
        status: 'COMPLETED',
        stays: ['CHECKED_OUT'],
      });
      expect(await movementsOf(reservation)).toEqual(before);
      expect(
        logs.some((line) =>
          line.includes(
            'la habitación ya está en CHECKED_OUT y se confirma sin cambios.',
          ),
        ),
      ).toBe(true);
    });
  });

  describe('los rechazos: no cambian nada, quedan en el log y no se reintentan', () => {
    /** Entrega el mensaje y revisa que no cambió nada, que quedó el motivo en el log y que no se reintenta. */
    async function expectRejected(
      message: ReturnType<typeof aMessage>,
      reservation: Reservation | null,
      reason: string,
    ): Promise<void> {
      const before = reservation === null ? null : await stored(reservation);

      await deliver(message);

      if (reservation !== null) {
        expect(await stored(reservation)).toEqual(before);
        expect(await movementsOf(reservation)).toEqual([]);
      }
      expect(logs.some((line) => line.includes(reason))).toBe(true);
      const queue = message.movementType === 'ENTRY' ? CHECK_IN : CHECK_OUT;
      expect(await messageCount(queue.name)).toBe(0);
      expect(await messageCount(deadLetterQueue(queue.name))).toBe(0);
    }

    it.each<ReservationStatus>([
      'PENDING',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ])('escenario 5: un Check-In de una reserva en %s', async (status) => {
      const stay: StayStatus =
        status === 'COMPLETED'
          ? 'CHECKED_OUT'
          : status === 'NO_SHOW'
            ? 'NOT_ARRIVED'
            : 'EXPECTED';
      const { reservation, rooms } = await aReservation(status, [stay]);

      await expectRejected(
        aMessage('ENTRY', reservation, rooms[0]),
        reservation,
        LOG.CHECK_IN_STATUS,
      );
    });

    it('escenario 6: un Check-In de una habitación que no pertenece a la reserva', async () => {
      const { reservation } = await aReservation('ACTIVE', [
        'EXPECTED',
        'EXPECTED',
      ]);

      await expectRejected(
        aMessage('ENTRY', reservation, randomUUID()),
        reservation,
        LOG.ROOM_NOT_IN_RESERVATION,
      );
    });

    it('escenario 9: el Check-Out de una habitación que no ha ingresado', async () => {
      const { reservation, rooms } = await aReservation('IN_PROGRESS', [
        'CHECKED_IN',
        'EXPECTED',
      ]);

      await expectRejected(
        aMessage('DEPARTURE', reservation, rooms[1]),
        reservation,
        LOG.ROOM_WITHOUT_CHECK_IN,
      );
    });

    it.each<ReservationStatus>(['ACTIVE', 'PENDING', 'CANCELLED', 'NO_SHOW'])(
      'escenario 10 y caso borde: un Check-Out de una reserva en %s, sin ingreso',
      async (status) => {
        const { reservation, rooms } = await aReservation(status, [
          status === 'NO_SHOW' ? 'NOT_ARRIVED' : 'EXPECTED',
        ]);

        await expectRejected(
          aMessage('DEPARTURE', reservation, rooms[0]),
          reservation,
          LOG.RESERVATION_WITHOUT_CHECK_IN,
        );
      },
    );

    it.each(['ENTRY', 'DEPARTURE'] as const)(
      'caso borde: la reserva notificada no existe (%s)',
      async (movementType) => {
        const { reservation, rooms } = await aReservation('ACTIVE', [
          'EXPECTED',
        ]);

        await expectRejected(
          aMessage(movementType, reservation, rooms[0], {
            reservationRef: 'RSV-00000000',
          }),
          null,
          LOG.RESERVATION_NOT_FOUND,
        );
      },
    );

    it('caso borde: el Check-In de una habitación NOT_ARRIVED (el huésped llegó después del cierre del día)', async () => {
      const { reservation, rooms } = await aReservation('IN_PROGRESS', [
        'CHECKED_IN',
        'NOT_ARRIVED',
      ]);

      await expectRejected(
        aMessage('ENTRY', reservation, rooms[1]),
        reservation,
        'La habitación notificada no admite un Check-In: está en NOT_ARRIVED.',
      );
    });
  });

  describe('casos borde que se procesan con normalidad', () => {
    it('el Check-In que llega antes de la fecha de inicio se aplica: el Módulo 1 valida las fechas', async () => {
      const { reservation, rooms } = await aReservation(
        'ACTIVE',
        ['EXPECTED'],
        {
          startDate: '2026-10-20',
          endDate: '2026-10-22',
        },
      );

      await deliver(aMessage('ENTRY', reservation, rooms[0]));

      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_IN'],
      });
    });

    it('el Check-Out que llega con retraso se aplica si la habitación sigue CHECKED_IN', async () => {
      const { reservation, rooms } = await aReservation('IN_PROGRESS', [
        'CHECKED_IN',
      ]);

      await deliver(
        aMessage('DEPARTURE', reservation, rooms[0], {
          movementDate: '2026-10-15',
        }),
      );

      expect(await stored(reservation)).toEqual({
        status: 'COMPLETED',
        stays: ['CHECKED_OUT'],
      });
    });

    it('si salieron todas las que ingresaron pero queda una EXPECTED, la reserva sigue IN_PROGRESS', async () => {
      const { reservation, rooms } = await aReservation('IN_PROGRESS', [
        'CHECKED_IN',
        'EXPECTED',
      ]);

      await deliver(aMessage('DEPARTURE', reservation, rooms[0]));

      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_OUT', 'EXPECTED'],
      });
    });

    it('salto de secuencia (FR-023): se advierte en el log y el mensaje se aplica igual', async () => {
      const { reservation, rooms } = await aReservation('ACTIVE', [
        'EXPECTED',
        'EXPECTED',
      ]);
      const first = aMessage('ENTRY', reservation, rooms[0]);
      await deliver(first);

      await deliver(
        aMessage('ENTRY', reservation, rooms[1], {
          sequenceNumber: first.sequenceNumber + 3,
        }),
      );

      expect(
        logs.some((line) =>
          line.includes(
            `Salto de secuencia en ${CHECK_IN.name}: se esperaba el ${first.sequenceNumber + 1} y llegó el ${first.sequenceNumber + 3}.`,
          ),
        ),
      ).toBe(true);
      expect(await stored(reservation)).toEqual({
        status: 'IN_PROGRESS',
        stays: ['CHECKED_IN', 'CHECKED_IN'],
      });
    });
  });

  describe('casos borde: el mensaje inutilizable va a la dead-letter sin cambiar nada', () => {
    /** El mensaje sin esos campos. */
    const without = (
      message: Record<string, unknown>,
      fields: string[],
    ): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(message).filter(([key]) => !fields.includes(key)),
      );

    it.each([
      [
        'vacío',
        [
          'messageId',
          'sequenceNumber',
          'reservationRef',
          'roomId',
          'movementType',
          'movementDate',
          'guests',
        ],
      ],
      ['sin reservationRef', ['reservationRef']],
      ['sin roomId', ['roomId']],
    ])(
      'un Check-In %s, con el mensaje del spec en el log',
      async (_case, fields) => {
        const { reservation, rooms } = await aReservation('ACTIVE', [
          'EXPECTED',
        ]);

        await publish(
          'ENTRY',
          without(aMessage('ENTRY', reservation, rooms[0]), fields),
        );

        await vi.waitFor(
          async () =>
            expect(await messageCount(deadLetterQueue(CHECK_IN.name))).toBe(1),
          { timeout: 10_000, interval: 100 },
        );
        expect(await stored(reservation)).toEqual({
          status: 'ACTIVE',
          stays: ['EXPECTED'],
        });
        const processed: unknown[] = await dataSource.query(
          'SELECT 1 FROM processed_message',
        );
        expect(processed).toEqual([]);
        expect(
          logs.some((line) =>
            line.includes(
              'El payload de notificación es inválido. Falta el identificador de la reserva o de la habitación.',
            ),
          ),
        ).toBe(true);
      },
    );
  });

  describe('los mensajes del contrato A, con su forma exacta y repetidos', () => {
    it('el Check-In y el Check-Out del ejemplo del plan se aplican, y repetidos con el mismo messageId no duplican nada', async () => {
      const { reservation, rooms } = await aReservation('ACTIVE', ['EXPECTED']);
      // La forma exacta del contrato A: estos son todos sus campos.
      const checkIn = {
        messageId: randomUUID(),
        sequenceNumber: 123,
        reservationRef: reservation.reservationRef,
        roomId: rooms[0],
        movementType: 'ENTRY',
        movementDate: '2026-10-09',
        guests: [ANA, JOHN],
      };
      const checkOut = {
        ...checkIn,
        messageId: randomUUID(),
        sequenceNumber: 124,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
      };

      await deliver(checkIn as ReturnType<typeof aMessage>);
      await deliver(checkOut as ReturnType<typeof aMessage>);
      await publish('ENTRY', checkIn);
      await publish('DEPARTURE', checkOut);
      await vi.waitFor(
        async () => {
          expect(await messageCount(CHECK_IN.name)).toBe(0);
          expect(await messageCount(CHECK_OUT.name)).toBe(0);
        },
        { timeout: 10_000, interval: 100 },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(await stored(reservation)).toEqual({
        status: 'COMPLETED',
        stays: ['CHECKED_OUT'],
      });
      expect(await movementsOf(reservation)).toHaveLength(4);
      const processed: { total: number }[] = await dataSource.query(
        'SELECT count(*)::int AS total FROM processed_message',
      );
      expect(processed[0].total).toBe(2);
    });
  });
});
