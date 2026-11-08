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
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../../support/database.js';

/**
 * T015 de `update-reservation` y T008 de `process-guest-data`: el consumidor conectado de verdad. Un
 * mensaje publicado en `hospitua.events` con la routing key `habitacion.checkin` llega a
 * `CheckInConsumer` por RabbitMQ y `ProcessCheckIn` lo aplica en PostgreSQL; uno inutilizable termina en
 * `m2.habitacion.checkin.dlq` sin cambiar nada. Los escenarios del spec, uno por uno, son de la T019.
 */

const CHECK_IN = INBOUND_QUEUES.CHECK_IN;
const DEAD_LETTER = deadLetterQueue(CHECK_IN.name);

describe('CheckInConsumer con RabbitMQ y PostgreSQL reales (T015)', () => {
  let moduleRef: TestingModule;
  let connection: AmqpConnection;
  let dataSource: DataSource;
  let reservations: ReservationRepository;
  let reservation: Reservation;
  let room201: string;

  /** El mensaje de Check-In del contrato A, para la 201 de la reserva. */
  function aCheckIn(changes: Record<string, unknown> = {}) {
    return {
      messageId: crypto.randomUUID(),
      sequenceNumber: 123,
      reservationRef: reservation.reservationRef,
      roomId: room201,
      movementType: 'ENTRY',
      movementDate: '2026-10-09',
      guests: [
        {
          firstName: 'Ana',
          lastName: 'Pérez',
          documentType: 'CC',
          documentNumber: '123',
          birthDate: '1995-03-20',
          nationality: 'Colombia',
        },
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
    connection.publish(EVENTS_EXCHANGE, CHECK_IN.routingKey, message, {
      persistent: true,
    });

  const messageCount = async (queue: string) =>
    (await connection.channel.checkQueue(queue)).messageCount;

  const stored = async () => {
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
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        MessagingModule,
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
          (await connection.channel.checkQueue(CHECK_IN.name)).consumerCount,
        ).toBe(1),
      { timeout: 15_000, interval: 100 },
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await connection.channel.purgeQueue(CHECK_IN.name);
    await connection.channel.purgeQueue(DEAD_LETTER);
    await truncateAllTables(dataSource);
    reservation = await reservations.insert(
      aDirectReservation({
        status: 'ACTIVE',
        rooms: [
          aDirectRoom({ roomNumber: '201' }),
          aDirectRoom({ roomNumber: '202' }),
        ],
      }),
    );
    const roomId = reservation.rooms[0].roomId;
    if (roomId === null) {
      throw new Error('La habitación de prueba no tiene roomId.');
    }
    room201 = roomId;
  });

  it('un Check-In publicado en la cola pasa la 201 a CHECKED_IN y la reserva a IN_PROGRESS, registra a los huéspedes y el mensaje', async () => {
    const message = aCheckIn();

    await publish(message);

    await vi.waitFor(
      async () =>
        expect(await stored()).toEqual({
          status: 'IN_PROGRESS',
          stays: [
            ['201', 'CHECKED_IN'],
            ['202', 'EXPECTED'],
          ],
        }),
      { timeout: 10_000, interval: 100 },
    );
    // Los huéspedes y el mensaje van en la misma transacción que el cambio.
    const movements: { document_number: string; movement_type: string }[] =
      await dataSource.query(
        `SELECT gd.document_number, mm.movement_type
         FROM migratory_movement mm JOIN guest_data gd ON gd.id = mm.guest_data_id
         ORDER BY gd.document_number`,
      );
    expect(movements).toEqual([
      { document_number: '123', movement_type: 'ENTRY' },
      { document_number: 'X99', movement_type: 'ENTRY' },
    ]);
    await expect(
      dataSource.query(
        'SELECT message_id, queue, sequence_number FROM processed_message',
      ),
    ).resolves.toEqual([
      {
        message_id: message.messageId,
        queue: CHECK_IN.name,
        sequence_number: '123',
      },
    ]);
    // Se confirmó: no queda en la cola ni en la dead-letter.
    expect(await messageCount(CHECK_IN.name)).toBe(0);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it('el mismo mensaje dos veces se confirma sin duplicar nada', async () => {
    const message = aCheckIn();

    await publish(message);
    await vi.waitFor(
      async () => expect(await count('processed_message')).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    await publish(message);
    // El segundo se confirma: la cola queda vacía y nada cambia.
    await vi.waitFor(
      async () => expect(await messageCount(CHECK_IN.name)).toBe(0),
      { timeout: 10_000, interval: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await count('processed_message')).toBe(1);
    expect(await count('migratory_movement')).toBe(2);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
  });

  it('T008 de process-guest-data: un mensaje sin reservationRef va a la dead-letter sin cambiar nada', async () => {
    const { reservationRef: _ref, ...withoutRef } = aCheckIn();

    await publish(withoutRef);

    await vi.waitFor(
      async () => expect(await messageCount(DEAD_LETTER)).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    expect(await stored()).toEqual({
      status: 'ACTIVE',
      stays: [
        ['201', 'EXPECTED'],
        ['202', 'EXPECTED'],
      ],
    });
    expect(await count('processed_message')).toBe(0);
    expect(await count('guest_data')).toBe(0);
  });

  it('T008 de process-guest-data: un huésped con caracteres no válidos manda todo el mensaje a la dead-letter, sin registrar a nadie', async () => {
    const message = aCheckIn();
    message.guests[1] = { ...message.guests[1], lastName: '<script>' };

    await publish(message);

    await vi.waitFor(
      async () => expect(await messageCount(DEAD_LETTER)).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    expect((await stored()).status).toBe('ACTIVE');
    expect(await count('guest_data')).toBe(0);
    expect(await count('processed_message')).toBe(0);
  });

  it('una reserva que no existe se confirma sin reintentar ni ir a la dead-letter, y deja el mensaje registrado', async () => {
    await publish(aCheckIn({ reservationRef: 'RSV-00000000' }));

    await vi.waitFor(
      async () => expect(await count('processed_message')).toBe(1),
      { timeout: 10_000, interval: 100 },
    );
    expect(await messageCount(CHECK_IN.name)).toBe(0);
    expect(await messageCount(DEAD_LETTER)).toBe(0);
    expect((await stored()).status).toBe('ACTIVE');
  });
});
