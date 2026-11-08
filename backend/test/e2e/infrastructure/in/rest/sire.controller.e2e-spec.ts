import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUEST_DATA_REPOSITORY,
  type GuestDataRepository,
} from '../../../../../src/application/ports/out/guest-data.repository.js';
import {
  MIGRATORY_MOVEMENT_REPOSITORY,
  type MigratoryMovementRepository,
} from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { GuestData } from '../../../../../src/domain/migration/guest-data.js';
import { MigratoryMovement } from '../../../../../src/domain/migration/migratory-movement.js';
import { aDirectReservation } from '../../../../support/builders.js';

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que `POST /api/sire/exports`
 * está conectada con el limitador, el caso de uso, la selección de `process-guest-data`, la configuración
 * `SIRE_*` y `sire_export`, y que los errores salen por el filtro global. Los escenarios del spec, uno por
 * uno, son de la T012. Usa un periodo de 2031 propio y un `X-User` distinto en cada prueba, para no
 * depender de otras pruebas ni del límite de 10 por minuto.
 */
describe('POST /api/sire/exports (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let johnEntryId: string;
  let anaEntryId: string;

  /** Las líneas de John con la configuración por defecto de desarrollo y pruebas. */
  const JOHN_ENTRY =
    'DEV-HOTEL\tDEV-CIUDAD\tPAS\tE2ESIRE1\tEstados Unidos\tSMITH\tJOHN\tE\t05/03/2031\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990';
  const JOHN_DEPARTURE =
    'DEV-HOTEL\tDEV-CIUDAD\tPAS\tE2ESIRE1\tEstados Unidos\tSMITH\tJOHN\tS\t08/03/2031\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990';

  const exportAs = (user: string | null, body: unknown) => {
    const call = request(app.getHttpServer()).post('/api/sire/exports');
    return (user === null ? call : call.set('X-User', user)).send(
      body as object,
    );
  };

  /** Las descargas registradas por ese usuario. */
  const exportsOf = (user: string) =>
    dataSource.query(
      `SELECT id::text, export_kind, records_count, date_range_start::text AS date_range_start,
              date_range_end::text AS date_range_end, processed_by
       FROM sire_export WHERE processed_by = $1`,
      [user],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);

    const reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation());
    const john = GuestData.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: 'E2ESIRE1',
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
    });
    const ana = GuestData.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'CC',
      documentNumber: 'E2ESIRE2',
      birthDate: '1995-03-20',
      nationality: 'Colombia',
      originPlace: null,
      destinationPlace: null,
    });
    const movement = (
      guest: GuestData,
      movementType: 'ENTRY' | 'DEPARTURE',
      movementDate: string,
    ) =>
      MigratoryMovement.restore({
        id: randomUUID(),
        guestDataId: guest.id,
        movementType,
        movementDate,
      });
    const movements = [
      movement(john, 'ENTRY', '2031-03-05'),
      movement(john, 'DEPARTURE', '2031-03-08'),
      movement(ana, 'ENTRY', '2031-03-05'),
    ];
    johnEntryId = movements[0].id;
    anaEntryId = movements[2].id;
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (tx) => {
      await app
        .get<GuestDataRepository>(GUEST_DATA_REPOSITORY)
        .insertMissing([john, ana], tx);
      await app
        .get<MigratoryMovementRepository>(MIGRATORY_MOVEMENT_REPOSITORY)
        .insertMissing(movements, tx);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('PERIOD: responde 200 con únicamente el archivo, sus cabeceras y la SireExport registrada; Ana, colombiana, no sale', async () => {
    const user = `recepcion-${randomUUID()}`;

    const res = await exportAs(user, {
      exportKind: 'PERIOD',
      startDate: '2031-03-01',
      endDate: '2031-03-31',
    }).expect(200);

    expect(res.text).toBe(`${JOHN_ENTRY}\r\n${JOHN_DEPARTURE}\r\n`);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    const [saved] = await exportsOf(user);
    expect(res.headers['export-id']).toBe(saved.id);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="SIRE_${saved.id}.txt"`,
    );
    expect(res.headers['access-control-expose-headers']).toBe(
      'Export-Id, Content-Disposition',
    );
    expect(saved).toEqual({
      id: saved.id,
      export_kind: 'PERIOD',
      records_count: 2,
      date_range_start: '2031-03-01',
      date_range_end: '2031-03-31',
      processed_by: user,
    });
  });

  it('SINGLE_MOVEMENT (T009): responde 200 con un .TXT de una línea y una SireExport de un registro sin fechas', async () => {
    const user = `recepcion-${randomUUID()}`;

    const res = await exportAs(user, {
      exportKind: 'SINGLE_MOVEMENT',
      movementId: johnEntryId,
    }).expect(200);

    expect(res.text).toBe(`${JOHN_ENTRY}\r\n`);
    const [saved] = await exportsOf(user);
    expect(res.headers['export-id']).toBe(saved.id);
    expect(saved).toMatchObject({
      export_kind: 'SINGLE_MOVEMENT',
      records_count: 1,
      date_range_start: null,
      date_range_end: null,
    });
  });

  it.each([
    [
      'un periodo sin extranjeros',
      { exportKind: 'PERIOD', startDate: '2031-06-01', endDate: '2031-06-30' },
      'NO_MIGRATORY_MOVEMENTS',
    ],
    [
      'otro tipo de exportación',
      { exportKind: 'MONTHLY' },
      'INVALID_EXPORT_KIND',
    ],
    [
      'una sola fecha',
      { exportKind: 'PERIOD', startDate: '2031-03-01' },
      'INCOMPLETE_DATE_RANGE',
    ],
    [
      'una fecha que no existe',
      { exportKind: 'PERIOD', startDate: '2031-02-30', endDate: '2031-03-31' },
      'INVALID_DATE',
    ],
    [
      'el periodo invertido',
      { exportKind: 'PERIOD', startDate: '2031-03-31', endDate: '2031-03-01' },
      'INVALID_DATE_RANGE',
    ],
    [
      'más de un año',
      { exportKind: 'PERIOD', startDate: '2031-01-01', endDate: '2032-01-02' },
      'PERIOD_TOO_LARGE',
    ],
    [
      'un movementId con otro formato',
      { exportKind: 'SINGLE_MOVEMENT', movementId: 'mov-1' },
      'MOVEMENT_NOT_FOUND',
    ],
    [
      'un movimiento que no existe',
      { exportKind: 'SINGLE_MOVEMENT', movementId: randomUUID() },
      'MOVEMENT_NOT_FOUND',
    ],
  ])(
    'responde 400 con %s, sin registrar nada',
    async (_caso, body, errorCode) => {
      const user = `recepcion-${randomUUID()}`;

      const res = await exportAs(user, body).expect(400);

      expect(res.body).toMatchObject({
        errorCode,
        path: '/api/sire/exports',
      });
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
      await expect(exportsOf(user)).resolves.toEqual([]);
    },
  );

  it('el movimiento de una colombiana es MOVEMENT_NOT_FOUND', async () => {
    const res = await exportAs(`recepcion-${randomUUID()}`, {
      exportKind: 'SINGLE_MOVEMENT',
      movementId: anaEntryId,
    }).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'MOVEMENT_NOT_FOUND' });
  });

  it('sin X-User responde 400 USER_REQUIRED antes de revisar el cuerpo', async () => {
    const res = await exportAs(null, { exportKind: 'MONTHLY' }).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'USER_REQUIRED' });
  });

  it('aplica el límite de solicitudes: la 11.ª del mismo usuario en el minuto responde 429 con Retry-After', async () => {
    const user = `recepcion-${randomUUID()}`;
    // Las 10 admitidas cuentan aunque la exportación las rechace (punto 13); así no tocan la base.
    for (let attempt = 0; attempt < 10; attempt++) {
      await exportAs(user, { exportKind: 'MONTHLY' }).expect(400);
    }

    const res = await exportAs(user, { exportKind: 'MONTHLY' }).expect(429);

    expect(res.body).toMatchObject({
      errorCode: 'TOO_MANY_REQUESTS',
      path: '/api/sire/exports',
    });
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
  });

  describe('GET /api/sire/movements/{movementId}/preview (C, T011)', () => {
    const preview = (movementId: string) =>
      request(app.getHttpServer()).get(
        `/api/sire/movements/${movementId}/preview`,
      );

    const exportCount = async (): Promise<number> => {
      const [{ total }]: { total: number }[] = await dataSource.query(
        'SELECT count(*)::int AS total FROM sire_export',
      );
      return total;
    };

    it('escenario 6: responde 200 con la forma de C y la línea del archivo, sin X-User y sin crear una SireExport', async () => {
      const before = await exportCount();

      const res = await preview(johnEntryId)
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(res.body).toMatchObject({
        movementId: johnEntryId,
        line: JOHN_ENTRY,
      });
      expect(res.body.reservationRef).toMatch(/^RSV-[0-9A-F]{8}$/);
      expect(res.body.fields).toHaveLength(12);
      expect(res.body.fields[5]).toEqual({
        position: 6,
        name: 'Apellidos',
        value: 'SMITH',
      });
      await expect(exportCount()).resolves.toBe(before);
    });

    it('no pasa por el límite de solicitudes de la exportación', async () => {
      for (let attempt = 0; attempt < 11; attempt++) {
        await preview(johnEntryId).expect(200);
      }
    });

    it.each([
      ['un movementId con otro formato', () => 'mov-1'],
      ['un movimiento que no existe', () => randomUUID()],
      ['el movimiento de una colombiana', () => anaEntryId],
    ])('responde 400 MOVEMENT_NOT_FOUND con %s', async (_caso, id) => {
      const movementId = id();

      const res = await preview(movementId).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'MOVEMENT_NOT_FOUND',
        message: 'El movimiento no existe.',
        path: `/api/sire/movements/${movementId}/preview`,
      });
    });
  });
});
