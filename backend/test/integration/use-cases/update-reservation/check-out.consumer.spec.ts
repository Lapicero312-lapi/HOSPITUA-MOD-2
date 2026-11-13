import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  afterAll,
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
import type { StayStatus } from '../../../../src/domain/shared/enums.js';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/**
 * T016 de `update-reservation`: el consumidor conectado de verdad. Un mensaje publicado en `hospitua.events`
 * con la routing key `habitacion.checkout` llega a `CheckOutConsumer` por RabbitMQ y `ProcessCheckOut` lo
 * aplica en PostgreSQL; uno inutilizable termina en `m2.habitacion.checkout.dlq` sin cambiar nada. Los
 * escenarios del spec, uno por uno, son de la T019.
 */

const CHECK_OUT = INBOUND_QUEUES.CHECK_OUT;
const DEAD_LETTER = deadLetterQueue(CHECK_OUT.name);

describe('CheckOutConsumer con RabbitMQ y PostgreSQL reales (T016)', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;
  let dataSource: DataSource;
  let reservations: ReservationRepository;

  /** Una reserva IN_PROGRESS con la 201 y la 202 en esos estados. Devuelve la reserva y sus `roomId`. */
  async function aReservationWith(room201: StayStatus, room202: StayStatus) {
    const reservation = await reservations.insert(
      aDirectReservation({
        status: 'IN_PROGRESS',
        rooms: [
          aDirectRoom({ roomNumber: '201', stayStatus: room201 }),
          aDirectRoom({ roomNumber: '202', stayStatus: room202 }),
        ],
      }),
    );
    const [first, second] = reservation.rooms.map(({ roomId }) => {
      if (roomId === null) {
        throw new Error('La habitación de prueba no tiene roomId.');
      }
      return roomId;
    });
    return { reservation, room201: first, room202: second };
  }

  /** El mensaje de Check-Out del contrato A. */
  function aCheckOut(
    reservation: Reservation,
    roomId: string,
    changes: Record<string, unknown> = {},
  ) {
    return {
      messageId: crypto.randomUUID(),
      sequenceNumber: 124,
      reservationRef: reservation.reservationRef,
      roomId,
      movementType: 'DEPARTURE',
      movementDate: '2026-10-12',
      guests: [
        {
          firstName: 'John',
          lastName: 'Smith',
          documentType: 'PAS',
          documentNumber: 'X99',
          birthDate: '1990-05-12',
          nationality: 'Estados Unidos',
          originPlace: 'Miami, Estados Unidos',
          destinationPlace: 'Cartagena, Colombia',
        },
      ],
      ...changes,
    };
  }

  const publish = (message: unknown) =>
    connection.publish(EVENTS_EXCHANGE, CHECK_OUT.routingKey, message, {
      persistent: true,
    });

  const messageCount = async (queue: string) =>
    (await connection.channel.checkQueue(queue)).messageCount;

  const stored = async (reservation: Reservation) => {
    const current = await reservations.findById(reservation.id);
    return {
      status: current?.status,
      stays: current?.rooms.map(({ roomNumber, stayStatus }) => [
        roomNumber,
        stayStatus,
      ]),
    };
  };

  const count = async (table: string): Promise<number> => {
    const [{ total }]: { total: number }[] = await dataSource.query(
      `SELECT count(*)::int AS total FROM ${table}`,
    );
    return total;
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
    // Los rechazos esperados no ensucian la salida de las pruebas.
    moduleRef.useLogger(false);
    await moduleRef.init();
    connection = moduleRef.get(AmqpConnection);
    dataSource = moduleRef.get(DataSource);
    reservations = moduleRef.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // El consumidor se suscribe cuando hay conexión, sin que el arranque lo espere.
    await vi.waitFor(
      async () =>
        expect(
          (await connection.channel.checkQueue(CHECK_OUT.name)).consumerCount,
        ).toBe(1),
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await connection.channel.purgeQueue(CHECK_OUT.name);
    await connection.channel.purgeQueue(DEAD_LETTER);
    await truncateAllTables(dataSource);
  });

  it('el Check-Out de la última habitación la pasa a CHECKED_OUT y la reserva a COMPLETED, registra el DEPARTURE y el mensaje', async () => {
    const { reservation, room202 } = await aReservationWith(
      'CHECKED_OUT',
      'CHECKED_IN',
    );
    const message = aCheckOut(reservation, room202);

    await publish(message);

    await vi.waitFor(
      async () =>
        expect(await stored(reservation)).toEqual({
          status: 'COMPLETED',
          stays: [
            ['201', 'CHECKED_OUT'],
            ['202', 'CHECKED_OUT'],
          ],
        }),
      { timeout: 10_000, interval: 100 },
    );
    const movements: { document_number: string; movement_type: string }[] =
      await dataSource.query(
        `SELECT gd.document_number, mm.movement_type
         FROM migratory_movement mm JOIN guest_data gd ON gd.id = mm.guest_data_id`,
      );
    expect(movements).toEqual([
      { document_number: 'X99', movement_type: 'DEPARTURE' },
    ]);
    await expect(
      dataSource.query(
        'SELECT message_id, queue, sequence_number FROM processed_message',
      ),
    ).resolves.toEqual([
      {
        message_id: message.messageId,
        queue: CHECK_OUT.name,
        sequence_number: '124',
      },
    ]);
    expect(await messageCount(CHECK_OUT.name)).toBe(0);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it('el Check-Out de una habitación con otra todavía ocupada deja la reserva IN_PROGRESS', async () => {
    const { reservation, room201 } = await aReservationWith(
      'CHECKED_IN',
      'CHECKED_IN',
    );

    await publish(aCheckOut(reservation, room201));

    await vi.waitFor(
      async () =>
        expect(await stored(reservation)).toEqual({
          status: 'IN_PROGRESS',
          stays: [
            ['201', 'CHECKED_OUT'],
            ['202', 'CHECKED_IN'],
          ],
        }),
      { timeout: 10_000, interval: 100 },
    );
  });

  it('el mismo mensaje dos veces se confirma sin duplicar nada', async () => {
    const { reservation, room201 } = await aReservationWith(
      'CHECKED_IN',
      'CHECKED_IN',
    );
    const message = aCheckOut(reservation, room201);

    await publish(message);
    await vi.waitFor(
      async () => expect(await count('processed_message')).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    await publish(message);
    await vi.waitFor(
      async () => expect(await messageCount(CHECK_OUT.name)).toBe(0),
      { timeout: 10_000, interval: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await count('processed_message')).toBe(1);
    expect(await count('migratory_movement')).toBe(1);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it('el Check-Out de una habitación ya en CHECKED_OUT, con otro messageId, no cambia nada más y deja el mensaje registrado con su sequenceNumber', async () => {
    const { reservation, room202 } = await aReservationWith(
      'CHECKED_IN',
      'CHECKED_OUT',
    );
    const message = aCheckOut(reservation, room202);

    await publish(message);
    await vi.waitFor(
      async () => expect(await count('processed_message')).toBe(1),
      { timeout: 10_000, interval: 100 },
    );

    await expect(
      dataSource.query(
        'SELECT message_id, queue, sequence_number FROM processed_message',
      ),
    ).resolves.toEqual([
      {
        message_id: message.messageId,
        queue: CHECK_OUT.name,
        sequence_number: '124',
      },
    ]);
    expect(await stored(reservation)).toEqual({
      status: 'IN_PROGRESS',
      stays: [
        ['201', 'CHECKED_IN'],
        ['202', 'CHECKED_OUT'],
      ],
    });
    expect(await count('migratory_movement')).toBe(0);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it('un mensaje sin roomId va a la dead-letter sin cambiar nada', async () => {
    const { reservation, room201 } = await aReservationWith(
      'CHECKED_IN',
      'CHECKED_IN',
    );
    const { roomId: _roomId, ...withoutRoom } = aCheckOut(reservation, room201);

    await publish(withoutRoom);

    await vi.waitFor(
      async () => expect(await messageCount(DEAD_LETTER)).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    expect((await stored(reservation)).stays).toEqual([
      ['201', 'CHECKED_IN'],
      ['202', 'CHECKED_IN'],
    ]);
    expect(await count('processed_message')).toBe(0);
  });

  it('un ENTRY en la cola de Check-Out va a la dead-letter: el tipo lo da la cola', async () => {
    const { reservation, room201 } = await aReservationWith(
      'CHECKED_IN',
      'CHECKED_IN',
    );

    await publish(aCheckOut(reservation, room201, { movementType: 'ENTRY' }));

    await vi.waitFor(
      async () => expect(await messageCount(DEAD_LETTER)).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    expect((await stored(reservation)).status).toBe('IN_PROGRESS');
  });
});
