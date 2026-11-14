import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../support/rooms.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';
import {
  type ModificationApp,
  modificationHttp,
  plusDays,
  startModificationApp,
} from '../support/modification-app.js';
import { startTcpProxy, type TcpProxy } from '../support/tcp-proxy.js';

/** El día operativo de la prueba, propio de este archivo. */
const TODAY = '2034-08-20';

/** La espera después del primer intento fallido (5 s), con margen. */
const FIRST_RETRY_DELAY_MS = 6_000;
/** La espera después del segundo intento fallido (15 s), con margen. */
const SECOND_RETRY_DELAY_MS = 16_000;

type MessageRow = {
  message_id: string;
  sequence_number: number;
  message_kind: string;
  update_type: string | null;
  removal_reason: string | null;
  publish_status: string;
  attempts: number;
  next_attempt_at: Date | null;
};

/**
 * T030 de `check-view-reservation`, el caso borde "caída de RabbitMQ y reanudación" (historia 5): con
 * RabbitMQ caído, las actualizaciones de la lista del día se guardan igual y quedan `PENDING`; la primera
 * suma su intento y espera su próxima hora, y las siguientes esperan detrás sin intentarse, para que ninguna
 * salga antes que una anterior. Cuando RabbitMQ vuelve, `PublishPendingDailyMessages` las publica en el
 * orden de su `sequence_number`.
 *
 * La aplicación completa entra a RabbitMQ por un proxy TCP que la prueba corta: para la aplicación es la
 * caída del broker, y el contenedor sigue arriba para las demás pruebas. Los cambios son dos cancelaciones
 * reales de la Recepcionista (`POST …/cancellation`) de reservas que ya viajaron en la lista.
 */
describe('check-view-reservation: la lista del día con RabbitMQ caído y su reanudación en orden (T030)', () => {
  let proxy: TcpProxy;
  let ctx: ModificationApp;
  /** Los `messageId` que RabbitMQ confirmó, en el orden en que los confirmó. */
  const confirmed: string[] = [];

  const messages = (): Promise<MessageRow[]> =>
    ctx.dataSource.query(
      `SELECT message_id, sequence_number, message_kind, update_type, removal_reason, publish_status,
              attempts, next_attempt_at
       FROM daily_list_message WHERE operational_date = $1 ORDER BY sequence_number`,
      [TODAY],
    );

  /** Lo confirmado de los mensajes de hoy: la lista vacía que se publica al arrancar no cuenta. */
  const confirmedToday = async (): Promise<string[]> => {
    const ids = new Set((await messages()).map(({ message_id }) => message_id));
    return confirmed.filter((id) => ids.has(id));
  };

  const cancel = async (reservationRef: string) => {
    const { body } = await modificationHttp(ctx.app)
      .detail(reservationRef)
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/cancellation`)
      .set('X-User', 'Laura Méndez')
      .send({ updatedAt: body.updatedAt as string, acknowledged: true })
      .expect(200);
  };

  const todays = (roomId: string, roomNumber: string): Reservation =>
    aDirectReservation({
      startDate: TODAY,
      endDate: plusDays(TODAY, 2),
      rooms: [aDirectRoom({ roomId, roomNumber, guestCount: 2 })],
      guest: aGuest(),
    });

  beforeAll(async () => {
    const rabbit = new URL(integrationEnv().RABBITMQ_URL);
    proxy = await startTcpProxy(rabbit.hostname, Number(rabbit.port));
    const viaProxy = new URL(rabbit);
    viaProxy.hostname = '127.0.0.1';
    viaProxy.port = String(proxy.port);
    ctx = await startModificationApp(TODAY, {
      rabbitmqUrl: viaProxy.toString(),
    });
    // La publicación real, sin cambiarla: solo se anota qué confirmó RabbitMQ y en qué orden.
    const connection = ctx.app.get(AmqpConnection);
    const publish = connection.publish.bind(connection);
    vi.spyOn(connection, 'publish').mockImplementation(
      async (exchange, routingKey, message, options) => {
        const result = await publish(exchange, routingKey, message, options);
        if (typeof options?.messageId === 'string') {
          confirmed.push(options.messageId);
        }
        return result;
      },
    );
    // El arranque no espera a RabbitMQ (`wait: false`): la prueba empieza con la conexión ya hecha.
    await vi.waitFor(() => expect(() => connection.channel).not.toThrow(), {
      timeout: 15_000,
      interval: 100,
    });
    await truncateAllTables(ctx.dataSource);
  }, 60_000);

  afterAll(async () => {
    await proxy?.up();
    if (ctx !== undefined) {
      await truncateAllTables(ctx.dataSource);
      await ctx.close();
    }
    await proxy?.close();
  });

  it('con RabbitMQ caído, las actualizaciones quedan PENDING detrás de la primera; al volver salen en el orden de su secuencia', async () => {
    // La lista de hoy sale con RabbitMQ arriba, con las dos reservas.
    const first = await ctx.reservations.insert(todays(ROOM_201.id, '201'));
    const second = await ctx.reservations.insert(todays(ROOM_202.id, '202'));
    await ctx.app.get<GenerateDailyList>(GENERATE_DAILY_LIST).execute(TODAY);
    await vi.waitFor(
      async () => {
        const [list] = await messages();
        expect(list).toMatchObject({
          message_kind: 'LIST',
          publish_status: 'PUBLISHED',
        });
      },
      { timeout: 15_000, interval: 100 },
    );
    const [list] = await messages();
    expect(await confirmedToday()).toEqual([list.message_id]);

    // RabbitMQ cae, y la Recepcionista cancela las dos.
    await proxy.down();
    await cancel(first.reservationRef);
    await cancel(second.reservationRef);

    // Las dos actualizaciones se guardaron con los cambios, en orden. La primera se intentó y espera su
    // próxima hora; la segunda espera detrás sin intentarse. Ninguna salió.
    await vi.waitFor(
      async () => {
        const [, removedFirst] = await messages();
        expect(removedFirst?.attempts).toBeGreaterThanOrEqual(1);
      },
      { timeout: 20_000, interval: 200 },
    );
    const [, removedFirst, removedSecond] = await messages();
    expect(removedFirst).toMatchObject({
      sequence_number: 2,
      update_type: 'REMOVED',
      removal_reason: 'CANCELLED',
      publish_status: 'PENDING',
    });
    expect(removedFirst.next_attempt_at).not.toBeNull();
    expect(removedSecond).toMatchObject({
      sequence_number: 3,
      update_type: 'REMOVED',
      removal_reason: 'CANCELLED',
      publish_status: 'PENDING',
      attempts: 0,
    });
    expect(await confirmedToday()).toEqual([list.message_id]);

    // Pasa la espera del reintento y RabbitMQ sigue caído: la tarea de cada 10 s encuentra las dos pendientes
    // en la misma pasada. La primera vuelve a fallar y la publicación se detiene ahí: la segunda sigue sin
    // intentarse.
    ctx.advanceClock(FIRST_RETRY_DELAY_MS);
    await vi.waitFor(
      async () => {
        const [, retried] = await messages();
        expect(retried?.attempts).toBeGreaterThanOrEqual(2);
      },
      { timeout: 20_000, interval: 200 },
    );
    const [, stillFirst, stillSecond] = await messages();
    expect(stillFirst.publish_status).toBe('PENDING');
    expect(stillSecond).toMatchObject({
      publish_status: 'PENDING',
      attempts: 0,
    });
    expect(await confirmedToday()).toEqual([list.message_id]);

    // RabbitMQ vuelve y pasa la espera del segundo reintento: la tarea de cada 10 s las publica, en orden.
    await proxy.up();
    ctx.advanceClock(SECOND_RETRY_DELAY_MS);
    await vi.waitFor(
      async () => {
        const rows = await messages();
        expect(rows.map(({ publish_status }) => publish_status)).toEqual([
          'PUBLISHED',
          'PUBLISHED',
          'PUBLISHED',
        ]);
      },
      { timeout: 40_000, interval: 200 },
    );
    expect(await confirmedToday()).toEqual([
      list.message_id,
      removedFirst.message_id,
      removedSecond.message_id,
    ]);
  }, 120_000);
});
