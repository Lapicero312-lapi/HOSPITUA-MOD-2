import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import { colombiaTimeWithMicroseconds } from '../../../src/application/use-cases/check-view-reservation/message-time.js';
import {
  GENERATE_DAILY_LIST,
  type GenerateDailyList,
} from '../../../src/application/use-cases/check-view-reservation/ports/in/generate-daily-list.port.js';
import {
  CANCEL_RESERVATION,
  type CancelReservation,
} from '../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from './database.js';

/** El día operativo y la hora del ejemplo de A: la cancelación del 2026-10-09 a las 10:15:20 de Colombia. */
export const TODAY = '2026-10-09';
export const NOW = new Date('2026-10-09T15:15:20.000Z');
const CLOCK_ON_TODAY: Clock = { today: () => TODAY, now: () => NOW };

/** La salida de la reserva del ejemplo de la lista del día (plan de `check-view-reservation`). */
export const CHECK_OUT_DATE = '2026-10-12';

/** La Recepcionista y el motivo del ejemplo de A. */
export const RECEPTIONIST = 'laura.mendez';
export const REASON = 'El huésped cambió de planes';

export type CancellationRow = {
  reservation_ref: string;
  cancellation_id: string;
  /** `cancellation_date` en milisegundos desde 1970. */
  cancellation_millis: number;
  reason: string | null;
  channel: string;
  processed_by: string;
  status: string;
};

export type ListUpdateRow = {
  sequence_number: number;
  update_type: string;
  removal_reason: string | null;
  reservation_ref: string;
  publish_status: string;
  payload: Record<string, unknown>;
};

export type AvailabilityMarkRow = {
  category_room: string;
  date_from: string;
  date_to: string;
};

/**
 * La aplicación completa (`AppModule`) con el PostgreSQL y el RabbitMQ de Testcontainers, para las pruebas
 * de integración de `cancel-reservation` (T011, T012 y T014). Solo el reloj es fijo: el día operativo y la
 * hora del ejemplo de A, para que "llegada hoy" y la lista del día sean de un día conocido.
 *
 * Cada canal entra por donde entrará en producción (plan, D1): la Recepcionista por la ruta A, con `X-User`,
 * y Booking por el puerto `CancelReservation` dentro de una transacción, como lo llamará
 * `generate-ota-reservation` (contrato B: no tiene ruta). La lista del día sale con `GenerateDailyList`,
 * la misma de las 00:00 (plan de `check-view-reservation`, T023).
 */
export class CancellationApp {
  /** La agencia de las reservas de Booking: su nombre es único, así que se guarda una sola por prueba. */
  private booking: Promise<string> | null = null;

  private constructor(
    readonly app: INestApplication<App>,
    readonly dataSource: DataSource,
    readonly reservations: ReservationRepository,
    readonly transactions: TransactionRunner,
    readonly cancelReservation: CancelReservation,
    private readonly otas: OtaRepository,
    private readonly dailyList: GenerateDailyList,
  ) {}

  static async start(): Promise<CancellationApp> {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(CLOCK_ON_TODAY)
      .compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    configureApp(app);
    // Escucha en un puerto libre: las solicitudes simultáneas (T012) llegan al mismo servidor.
    await app.listen(0, '127.0.0.1');
    return new CancellationApp(
      app,
      app.get(DataSource),
      app.get<ReservationRepository>(RESERVATION_REPOSITORY),
      app.get<TransactionRunner>(TRANSACTION_RUNNER),
      app.get<CancelReservation>(CANCEL_RESERVATION),
      app.get<OtaRepository>(OTA_REPOSITORY),
      app.get<GenerateDailyList>(GENERATE_DAILY_LIST),
    );
  }

  /** Deja la base vacía para la prueba siguiente. */
  async reset(): Promise<void> {
    await truncateAllTables(this.dataSource);
    this.booking = null;
  }

  async close(): Promise<void> {
    await truncateAllTables(this.dataSource);
    await this.app.close();
  }

  /** Una reserva directa guardada, con llegada hoy salvo que `changes` diga otra cosa. */
  storeDirect(changes: Partial<ReservationProps> = {}): Promise<Reservation> {
    return this.reservations.insert(
      aDirectReservation({
        startDate: TODAY,
        endDate: CHECK_OUT_DATE,
        ...changes,
      }),
    );
  }

  /** Una reserva de Booking guardada, en su agencia, con llegada hoy salvo que `changes` diga otra cosa. */
  async storeBooking(
    changes: Partial<ReservationProps> = {},
  ): Promise<Reservation> {
    this.booking ??= this.otas.insert(anOta()).then((ota) => ota.id);
    return this.reservations.insert(
      anOtaReservation(await this.booking, {
        startDate: TODAY,
        endDate: CHECK_OUT_DATE,
        ...changes,
      }),
    );
  }

  /** La lista de hoy sale (secuencia 1) con las llegadas que le pertenecen en este momento. */
  async sendDailyList(): Promise<void> {
    if (!(await this.dailyList.execute(TODAY))) {
      throw new Error('La lista del día ya había salido.');
    }
  }

  /** Las referencias de las reservas que viajaron en la lista de hoy. */
  async listedReservations(): Promise<string[]> {
    const rows: { payload: { reservations: { reservationRef: string }[] } }[] =
      await this.dataSource.query(
        `SELECT payload FROM daily_list_message
         WHERE operational_date = $1 AND message_kind = 'LIST'`,
        [TODAY],
      );
    return rows.flatMap((row) =>
      row.payload.reservations.map(({ reservationRef }) => reservationRef),
    );
  }

  /** La cancelación de la Recepcionista por la ruta A. */
  byReception(reservationRef: string, body: object, user = RECEPTIONIST) {
    return request(this.app.getHttpServer())
      .post(`/api/reservations/${reservationRef}/cancellation`)
      .set('X-User', user)
      .send(body);
  }

  /** El cuerpo de A, con el `updatedAt` de la reserva como lo lee la pantalla: en hora de Colombia y con seis decimales. */
  bodyFor(reservation: Reservation, changes: object = {}): object {
    return {
      updatedAt: colombiaTimeWithMicroseconds(reservation.updatedAt as string),
      acknowledged: true,
      reason: REASON,
      ...changes,
    };
  }

  /** La cancelación de Booking del contrato B, en su propia transacción. */
  byBooking(reservationRef: string): Promise<Reservation> {
    return this.transactions.run((tx) =>
      this.cancelReservation.cancel(tx, {
        reservationRef,
        channel: 'OTA_API',
        processedBy: 'Booking.com',
        reason: null,
      }),
    );
  }

  /** La reserva como quedó guardada. */
  async stored(reservationRef: string): Promise<Reservation> {
    const reservation = await this.reservations.findByRef(reservationRef);
    if (reservation === null) {
      throw new Error(`La reserva ${reservationRef} no existe.`);
    }
    return reservation;
  }

  /** Si cada habitación de la reserva sigue ocupando inventario, en orden de número. */
  async blocksInventory(reservation: Reservation): Promise<boolean[]> {
    const rows: { blocks_inventory: boolean }[] = await this.dataSource.query(
      `SELECT blocks_inventory FROM reservation_room
       WHERE reservation_id = $1 ORDER BY room_number`,
      [reservation.id],
    );
    return rows.map((row) => row.blocks_inventory);
  }

  cancellations(): Promise<CancellationRow[]> {
    return this.dataSource.query(
      `SELECT r.reservation_ref, c.id::text AS cancellation_id,
              (extract(epoch FROM c.cancellation_date) * 1000)::float8 AS cancellation_millis,
              c.reason, c.channel, c.processed_by, c.status
       FROM cancellation c JOIN reservation r ON r.id = c.reservation_id
       ORDER BY r.reservation_ref`,
    );
  }

  /** Los avisos que se dejaron para el Módulo 1 después de la lista (secuencia 2 en adelante). */
  listUpdates(): Promise<ListUpdateRow[]> {
    return this.dataSource.query(
      `SELECT m.sequence_number, m.update_type, m.removal_reason, r.reservation_ref,
              m.publish_status, m.payload
       FROM daily_list_message m JOIN reservation r ON r.id = m.reservation_id
       WHERE m.message_kind = 'UPDATE'
       ORDER BY m.operational_date, m.sequence_number`,
    );
  }

  /** La disponibilidad anotada para el envío a Channex (`configure-ota`). */
  availabilityMarks(): Promise<AvailabilityMarkRow[]> {
    return this.dataSource.query(
      `SELECT category_room, date_from::text, date_to::text
       FROM ari_pending_change ORDER BY category_room, date_from`,
    );
  }
}
