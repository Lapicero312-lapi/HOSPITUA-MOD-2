import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  type GuestPayload,
  REGISTER_GUEST_MOVEMENTS,
  type RegisterGuestMovements,
} from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import { configureApp } from '../../../src/configure-app.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { pinoHttpOptions } from '../../../src/infrastructure/shared/logging.options.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from './database.js';

/** Una estadía: los huéspedes que registró el Check-In y, si ya salieron, el Check-Out. */
export type SireStay = {
  guests: GuestPayload[];
  entry: string;
  exit: string | null;
  /** La salida prevista de la reserva. */
  endDate: string;
};

/**
 * La aplicación completa (`AppModule`) por HTTP, con PostgreSQL y RabbitMQ reales y la configuración `SIRE_*`
 * por defecto de pruebas (`DEV-HOTEL`, `DEV-CIUDAD`, tabulador, `dd/MM/yyyy`, CRLF y `utf-8`). Empieza con
 * la base vacía.
 *
 * Con `onLog`, los logs salen como en producción (`main.ts`: todo lo que se escribe con el `Logger` de Nest
 * pasa por nestjs-pino), pero en el nivel más bajo (`trace`), para que ninguno quede sin revisar, y cada
 * escritura llega a `onLog` en vez de a la salida. Sin `onLog`, la aplicación no escribe logs.
 */
export async function startSireApp(onLog?: (written: string) => void) {
  // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
  Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
  const { AppModule } = await import('../../../src/app.module.js');
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (onLog !== undefined) {
    const destination = new Writable({
      write(chunk: Buffer, _encoding, done) {
        onLog(chunk.toString());
        done();
      },
    });
    builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({ pinoHttp: [pinoHttpOptions('trace'), destination] });
  }
  const moduleRef = await builder.compile();
  const app: INestApplication<App> = moduleRef.createNestApplication(
    onLog === undefined ? { logger: false } : { bufferLogs: true },
  );
  if (onLog !== undefined) {
    app.useLogger(app.get(Logger));
  }
  configureApp(app);
  await app.init();
  const dataSource = app.get(DataSource);
  await truncateAllTables(dataSource);
  const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
  const registration = app.get<RegisterGuestMovements>(
    REGISTER_GUEST_MOVEMENTS,
  );
  const transactions = app.get<TransactionRunner>(TRANSACTION_RUNNER);

  /**
   * Guarda la reserva y registra sus huéspedes como los envía el Módulo 1: el Check-In y, si ya salieron,
   * el Check-Out, cada uno en su transacción, con `RegisterGuestMovements`.
   */
  async function stay(data: SireStay): Promise<Reservation> {
    const checkedOut = data.exit !== null;
    const reservation = await reservations.insert(
      aDirectReservation({
        startDate: data.entry,
        endDate: data.endDate,
        status: checkedOut ? 'COMPLETED' : 'IN_PROGRESS',
        statusReason: checkedOut ? 'CHECK_OUT' : 'CHECK_IN',
        rooms: [
          aDirectRoom({
            stayStatus: checkedOut ? 'CHECKED_OUT' : 'CHECKED_IN',
          }),
        ],
      }),
    );
    const roomId = reservation.rooms[0].roomId as string;
    await transactions.run((tx) =>
      registration.register(tx, {
        reservationId: reservation.id,
        roomId,
        movementType: 'ENTRY',
        movementDate: data.entry,
        guests: data.guests,
      }),
    );
    if (data.exit !== null) {
      const exit = data.exit;
      await transactions.run((tx) =>
        registration.register(tx, {
          reservationId: reservation.id,
          roomId,
          movementType: 'DEPARTURE',
          movementDate: exit,
          guests: data.guests,
        }),
      );
    }
    return reservation;
  }

  /** `POST /api/sire/exports` con ese `X-User`: cada prueba usa el suyo, por el límite por usuario. */
  const exportAs = (user: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/sire/exports')
      .set('X-User', user)
      .send(body);

  const exportPeriod = (user: string, startDate: string, endDate: string) =>
    exportAs(user, { exportKind: 'PERIOD', startDate, endDate });

  /** Las `SireExport` que registró ese usuario. */
  const exportsOf = (
    user: string,
  ): Promise<
    {
      id: string;
      export_kind: string;
      records_count: number;
      date_range_start: string | null;
      date_range_end: string | null;
    }[]
  > =>
    dataSource.query(
      `SELECT id::text, export_kind, records_count, date_range_start::text AS date_range_start,
              date_range_end::text AS date_range_end
       FROM sire_export WHERE processed_by = $1 ORDER BY export_date, id`,
      [user],
    );

  /** El `id` del movimiento de ese huésped en esa reserva. */
  const movementIdOf = async (
    reservation: Reservation,
    documentNumber: string,
    movementType: 'ENTRY' | 'DEPARTURE',
  ): Promise<string> => {
    const [row]: { id: string }[] = await dataSource.query(
      `SELECT mm.id::text FROM migratory_movement mm
       JOIN guest_data gd ON gd.id = mm.guest_data_id
       WHERE gd.reservation_id = $1 AND gd.document_number = $2 AND mm.movement_type = $3`,
      [reservation.id, documentNumber, movementType],
    );
    return row.id;
  };

  return {
    app,
    dataSource,
    stay,
    exportAs,
    exportPeriod,
    exportsOf,
    movementIdOf,
  };
}
