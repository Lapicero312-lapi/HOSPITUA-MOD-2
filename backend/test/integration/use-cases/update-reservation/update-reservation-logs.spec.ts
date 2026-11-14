import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import request from 'supertest';
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
  CLOSE_DAY,
  type CloseDay,
} from '../../../../src/application/use-cases/update-reservation/ports/in/close-day.port.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import {
  deadLetterQueue,
  EVENTS_EXCHANGE,
  INBOUND_QUEUES,
} from '../../../../src/infrastructure/config/rabbitmq.topology.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../../support/rooms.js';
import { truncateAllTables } from '../../support/database.js';
import {
  type ModificationApp,
  type ModificationHttp,
  modificationHttp,
  plusDays,
  startModificationApp,
} from '../../support/modification-app.js';

/** Un día operativo de 2036, propio de esta prueba; la reserva llega hoy y sale en dos días. */
const TODAY = '2036-10-01';
const END = '2036-10-03';

/** El titular guardado de la reserva. */
const HOLDER = {
  firstName: 'Graciela',
  lastName: 'Montoya',
  documentNumber: '43777111',
  nationality: 'Argentina',
  contactPhone: '+57 315 555 0101',
  contactEmail: 'graciela.montoya@correo.com',
};

/** El titular corregido que envía la pantalla en B1 y B2 (sin nacionalidad). */
const CORRECTION = {
  firstName: 'Mariela',
  lastName: 'Quintero',
  documentType: 'CC',
  documentNumber: '1017222333',
  contactPhone: '+57 320 444 0202',
  contactEmail: 'mariela.quintero@correo.com',
};

/** Los huéspedes que envía el Módulo 1 en el Check-In y el Check-Out: una colombiana y un extranjero. */
const GUESTS = [
  {
    firstName: 'Teodora',
    lastName: 'Arbeláez',
    documentType: 'CC',
    documentNumber: '71888999',
    birthDate: '1988-02-14',
    nationality: 'Colombia',
  },
  {
    firstName: 'Sigurd',
    lastName: 'Halvorsen',
    documentType: 'PAS',
    documentNumber: 'NO4471829',
    birthDate: '1991-07-30',
    nationality: 'Noruega',
    originPlace: 'Oslo, Noruega',
    destinationPlace: 'Santa Marta, Colombia',
  },
];

/**
 * Lo que no puede salir en un log: todos los datos personales del titular y de los huéspedes, salvo el
 * tipo de documento. La nacionalidad "Colombia" se deja fuera porque es también el país del hotel; la del
 * extranjero sí cuenta.
 */
const PERSONAL_DATA = [
  ...Object.values(HOLDER),
  ...Object.entries(CORRECTION)
    .filter(([field]) => field !== 'documentType')
    .map(([, value]) => value),
  ...GUESTS.flatMap(({ documentType: _type, nationality, ...guest }) => [
    ...Object.values(guest),
    ...(nationality === 'Colombia' ? [] : [nationality]),
  ]),
];

/**
 * T031 de `update-reservation`: ningún log escribe datos personales de los huéspedes (plan base, "Logs y
 * correlación"; plan del caso de uso, "Colas (Check-In y Check-Out)": los rechazos y la dead-letter queue
 * van al log "sin datos personales"). Los datos personales llegan por dos lados:
 * - el titular, en el cuerpo de B1 y B2;
 * - los huéspedes, en los mensajes de Check-In y Check-Out del Módulo 1.
 *
 * La aplicación completa, con PostgreSQL y RabbitMQ reales (los mensajes pasan por la cola y su
 * consumidor) y sus logs como en producción, en el nivel más bajo y dirigidos a la prueba; también se
 * recoge lo que se escriba con `console`. Se recorre cada camino, los que terminan bien y los que fallan,
 * y se revisa todo lo que se escribió.
 */
describe('update-reservation: los logs no escriben datos personales (T031)', () => {
  let ctx: ModificationApp;
  let api: ModificationHttp;
  let amqp: AmqpConnection;
  let sequence = 1000;
  /** Lo que escribe pino, tal como sale, y lo que se escribe con `console`. */
  let written: string[] = [];
  let consoleLines: string[] = [];

  const allLogs = () => [...written, ...consoleLines].join('\n');

  /** Ninguno de los datos personales, ni los valores rechazados, aparece en lo que se escribió. */
  const expectNoPersonalData = (rejected: readonly string[] = []) => {
    const logs = allLogs();
    for (const value of [...PERSONAL_DATA, ...rejected]) {
      expect(logs, `el log tiene "${value}"`).not.toContain(value);
    }
  };

  /** Espera el log de la solicitud HTTP, que se escribe al terminar la respuesta, con su estado. */
  const untilRequestLogged = (statusCode: number) =>
    vi.waitFor(
      () =>
        expect(allLogs()).toMatch(
          new RegExp(`"res":\\{[^}]*"statusCode":${statusCode}`),
        ),
      { timeout: 5_000, interval: 10 },
    );

  /** Una reserva directa `ACTIVE` del titular, que llega hoy, en la 201. */
  const stored = () =>
    ctx.reservations.insert(
      aDirectReservation({
        startDate: TODAY,
        endDate: END,
        guest: aGuest(HOLDER),
        rooms: [
          aDirectRoom({
            roomId: ROOM_201.id,
            roomNumber: '201',
            categoryRoom: 'DOBLE',
            guestCount: 2,
            rate: {
              roomGrossAmount: Money.of('600000.00', 'COP'),
              quoteId: 'Q-201',
            },
          }),
        ],
      }),
    );

  /** El mensaje del contrato A, de Check-In o Check-Out de la 201, con los dos huéspedes. */
  const aStayMessage = (
    reservation: Reservation,
    movementType: 'ENTRY' | 'DEPARTURE',
    changes: Record<string, unknown> = {},
  ) => ({
    messageId: randomUUID(),
    sequenceNumber: ++sequence,
    reservationRef: reservation.reservationRef,
    roomId: ROOM_201.id,
    movementType,
    movementDate: movementType === 'ENTRY' ? TODAY : END,
    guests: GUESTS,
    ...changes,
  });
  const publish = (
    queue: typeof INBOUND_QUEUES.CHECK_IN | typeof INBOUND_QUEUES.CHECK_OUT,
    message: unknown,
  ) =>
    amqp.publish(EVENTS_EXCHANGE, queue.routingKey, message, {
      persistent: true,
    });

  const statusOf = async ({ id }: Reservation) => {
    const [{ status }]: { status: string }[] = await ctx.dataSource.query(
      'SELECT status FROM reservation WHERE id = $1',
      [id],
    );
    return status;
  };
  const processed = async (messageId: string) => {
    const rows: unknown[] = await ctx.dataSource.query(
      'SELECT 1 FROM processed_message WHERE message_id = $1',
      [messageId],
    );
    return rows.length;
  };
  /** Espera a que el consumidor procese el mensaje, por lo que deja: una condición o una línea del log. */
  const until = (check: () => Promise<void> | void) =>
    vi.waitFor(check, { timeout: 10_000, interval: 25 });

  beforeAll(async () => {
    const logs = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    ctx = await startModificationApp(TODAY, { logs });
    api = modificationHttp(ctx.app);
    amqp = ctx.app.get(AmqpConnection);
  });

  beforeEach(async () => {
    ctx.setToday(TODAY);
    ctx.resetModules();
    await truncateAllTables(ctx.dataSource);
    for (const queue of [INBOUND_QUEUES.CHECK_IN, INBOUND_QUEUES.CHECK_OUT]) {
      await amqp.channel.purgeQueue(deadLetterQueue(queue.name));
    }
    written = [];
    consoleLines = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('B1 y B2 con el titular en el cuerpo', () => {
    it('la vista previa y la confirmación que corrigen el titular', async () => {
      const reservation = await stored();

      const { confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        { updatedAt: reservation.updatedAt, guest: CORRECTION },
      );

      expect(confirmed.status).toBe(200);
      await untilRequestLogged(200);
      expectNoPersonalData();
    });

    it('un titular con caracteres no válidos: 400 INVALID_CHARACTERS', async () => {
      const reservation = await stored();
      // Un carácter de control: lo único que la modificación no admite en el titular (regla 7).
      const rejected = 'Mariela\u0007';

      await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          guest: { ...CORRECTION, firstName: rejected },
        })
        .expect(400);

      await untilRequestLogged(400);
      expectNoPersonalData([rejected]);
    });

    it('un titular con nacionalidad: 400 NATIONALITY_NOT_EDITABLE', async () => {
      const reservation = await stored();

      await api
        .confirm(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          guest: { ...CORRECTION, nationality: 'Islandia' },
          expectedRates: [],
        })
        .expect(400);

      await untilRequestLogged(400);
      expectNoPersonalData(['Islandia']);
    });

    it('el Módulo 3 caído al recotizar: 400 RECALCULATION_UNAVAILABLE, con su error en el log', async () => {
      const reservation = await stored();
      ctx.modules.module3Down = true;

      await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          endDate: plusDays(END, 1),
          guest: CORRECTION,
        })
        .expect(400);

      await untilRequestLogged(400);
      expectNoPersonalData();
    });

    it('otra persona la cambió: 400 CONCURRENT_UPDATE', async () => {
      const reservation = await stored();

      await api
        .confirm(reservation.reservationRef, {
          updatedAt: '2036-09-01T10:00:00.000000-05:00',
          guest: CORRECTION,
          expectedRates: [],
        })
        .expect(400);

      await untilRequestLogged(400);
      expectNoPersonalData();
    });

    it('un cuerpo que no es JSON: el error de lectura no copia el texto recibido', async () => {
      const reservation = await stored();

      // Sin comillas en el nombre: el mensaje de JSON.parse cita el texto desde el carácter inesperado.
      await request(ctx.app.getHttpServer())
        .patch(`/api/reservations/${reservation.reservationRef}`)
        .set('Content-Type', 'application/json')
        .send(
          `{"updatedAt":"${reservation.updatedAt}","guest":{"firstName":${CORRECTION.firstName}}}`,
        )
        .expect(400);

      expectNoPersonalData();
    });
  });

  describe('Check-In y Check-Out con los huéspedes en el mensaje', () => {
    it('un Check-In aplicado, su repetición y el Check-Out', async () => {
      const reservation = await stored();
      const checkIn = aStayMessage(reservation, 'ENTRY');

      await publish(INBOUND_QUEUES.CHECK_IN, checkIn);
      await until(async () =>
        expect(await statusOf(reservation)).toBe('IN_PROGRESS'),
      );
      // El mismo mensaje otra vez: duplicado, se confirma sin efectos.
      const duplicates = written.length;
      await publish(INBOUND_QUEUES.CHECK_IN, checkIn);
      await until(() => expect(written.length).toBeGreaterThan(duplicates));
      await publish(
        INBOUND_QUEUES.CHECK_OUT,
        aStayMessage(reservation, 'DEPARTURE'),
      );
      await until(async () =>
        expect(await statusOf(reservation)).toBe('COMPLETED'),
      );

      expect(await processed(checkIn.messageId)).toBe(1);
      expectNoPersonalData();
    });

    it.each([
      [
        'una reserva que no existe',
        { reservationRef: 'RSV-FFFFFFFF' },
        'La reserva notificada no existe en el sistema de reservas.',
      ],
      [
        'una habitación ajena a la reserva',
        { roomId: ROOM_202.id },
        'La habitación notificada no pertenece a la reserva.',
      ],
    ])(
      'un Check-In rechazado (%s): el log dice el motivo, sin datos de los huéspedes',
      async (_case, changes, message) => {
        const reservation = await stored();

        await publish(
          INBOUND_QUEUES.CHECK_IN,
          aStayMessage(reservation, 'ENTRY', changes),
        );

        await until(() => expect(allLogs()).toContain(message));
        expect(await statusOf(reservation)).toBe('ACTIVE');
        expectNoPersonalData();
      },
    );

    it('un Check-Out sin ingreso: se rechaza sin datos de los huéspedes', async () => {
      const reservation = await stored();
      const checkOut = aStayMessage(reservation, 'DEPARTURE');
      const before = written.length;

      await publish(INBOUND_QUEUES.CHECK_OUT, checkOut);

      await until(() => expect(written.length).toBeGreaterThan(before));
      expect(await statusOf(reservation)).toBe('ACTIVE');
      expectNoPersonalData();
    });

    it.each([
      [
        'sin la reserva',
        { reservationRef: undefined },
        'El payload de notificación es inválido. Falta el identificador de la reserva o de la habitación.',
        [],
      ],
      [
        'con caracteres no permitidos en un huésped',
        { guests: [{ ...GUESTS[0], firstName: 'Teodora<b>' }, GUESTS[1]] },
        'Caracteres no válidos en los datos de los huéspedes.',
        ['Teodora<b>'],
      ],
    ])(
      'un payload inválido (%s): va a la dead-letter queue y el log no copia el mensaje',
      async (_case, changes, message, rejected) => {
        const reservation = await stored();

        await publish(
          INBOUND_QUEUES.CHECK_IN,
          aStayMessage(reservation, 'ENTRY', changes),
        );

        await until(() => expect(allLogs()).toContain(message));
        await until(async () =>
          expect(
            (
              await amqp.channel.checkQueue(
                deadLetterQueue(INBOUND_QUEUES.CHECK_IN.name),
              )
            ).messageCount,
          ).toBe(1),
        );
        expectNoPersonalData(rejected);
      },
    );
  });

  it('el cierre del día: la reserva que no se presentó pasa a NO_SHOW sin datos del titular en el log', async () => {
    const reservation = await stored();
    // El día de llegada ya terminó: se cierra.
    ctx.setToday(plusDays(TODAY, 1));

    await ctx.app.get<CloseDay>(CLOSE_DAY).execute(TODAY);

    expect(await statusOf(reservation)).toBe('NO_SHOW');
    expectNoPersonalData();
  });
});
