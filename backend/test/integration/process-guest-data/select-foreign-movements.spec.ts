import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GUEST_DATA_REPOSITORY,
  type GuestDataRepository,
} from '../../../src/application/ports/out/guest-data.repository.js';
import {
  MIGRATORY_MOVEMENT_REPOSITORY,
  type MigratoryMovementRepository,
} from '../../../src/application/ports/out/migratory-movement.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
} from '../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import { GuestData } from '../../../src/domain/migration/guest-data.js';
import { MigratoryMovement } from '../../../src/domain/migration/migratory-movement.js';
import type {
  DocumentType,
  MovementType,
} from '../../../src/domain/shared/enums.js';
import { aDirectReservation } from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T013 de `process-guest-data`: los escenarios 1 y 2 de la historia 2 del spec, con los datos de la tabla
 * "Pruebas por escenario" del plan ("Tres extranjeros y dos colombianos: se entregan los tres, con tipo y
 * fecha"; "Lista vacía"). Todo es real: `ProcessGuestDataModule` con `SelectForeignMovements`, inyectado
 * desde fuera como lo hará `export-sire-file`, los repositorios y PostgreSQL.
 */

/** El periodo que pide "Exportar archivo SIRE": octubre de 2026. */
const FROM = '2026-10-01';
const TO = '2026-10-31';

/** El símbolo del proveedor de prueba que inyecta `SELECT_FOREIGN_MOVEMENTS` desde fuera de su módulo. */
const INJECTED_SELECTION = Symbol('INJECTED_SELECTION');

type GuestSeed = {
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  birthDate: string;
  nationality: string;
  originPlace: string | null;
  destinationPlace: string | null;
};

/** John, del mensaje de Check-In del plan de `update-reservation`. */
const JOHN: GuestSeed = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};
const PIERRE: GuestSeed = {
  firstName: 'Pierre',
  lastName: 'Dubois',
  documentType: 'PAS',
  documentNumber: 'FR123456',
  birthDate: '1985-02-03',
  nationality: 'Francia',
  originPlace: 'París, Francia',
  destinationPlace: 'Medellín, Colombia',
};
const ANDREA: GuestSeed = {
  firstName: 'Andrea',
  lastName: 'Rojas',
  documentType: 'CE',
  documentNumber: 'V8812345',
  birthDate: '1993-11-21',
  nationality: 'Venezuela',
  originPlace: 'Caracas, Venezuela',
  destinationPlace: 'Bogotá, Colombia',
};
/** Ana, del mismo mensaje: colombiana, sin procedencia ni destino. */
const ANA: GuestSeed = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
  originPlace: null,
  destinationPlace: null,
};
const CARLOS: GuestSeed = {
  firstName: 'Carlos',
  lastName: 'Gómez',
  documentType: 'CC',
  documentNumber: '1144093552',
  birthDate: '1988-07-14',
  nationality: 'Colombia',
  originPlace: null,
  destinationPlace: null,
};

describe('SelectForeignMovements contra PostgreSQL real (T013, historia 2)', () => {
  let moduleRef: TestingModule;
  let selection: SelectForeignMovements;
  let dataSource: DataSource;

  /**
   * Una reserva con sus huéspedes, y los movimientos de cada uno. Devuelve la `reservationRef` y, por
   * documento, el id de cada movimiento.
   */
  async function stay(
    guests: GuestSeed[],
    movements: { documentNumber: string; type: MovementType; date: string }[],
  ): Promise<{ reservationRef: string; movementIds: Map<string, string> }> {
    const reservation = await moduleRef
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation());
    const guestData = guests.map((guest) =>
      GuestData.restore({
        id: randomUUID(),
        reservationRef: reservation.reservationRef,
        ...guest,
      }),
    );
    const movementIds = new Map<string, string>();
    const records = movements.map(({ documentNumber, type, date }) => {
      const guest = guestData.find(
        (candidate) => candidate.documentNumber === documentNumber,
      );
      if (guest === undefined) {
        throw new Error(`No hay huésped con el documento ${documentNumber}`);
      }
      const movement = MigratoryMovement.restore({
        id: randomUUID(),
        guestDataId: guest.id,
        movementType: type,
        movementDate: date,
      });
      movementIds.set(`${documentNumber} ${type}`, movement.id);
      return movement;
    });
    await moduleRef
      .get<TransactionRunner>(TRANSACTION_RUNNER)
      .run(async (tx) => {
        await moduleRef
          .get<GuestDataRepository>(GUEST_DATA_REPOSITORY)
          .insertMissing(guestData, tx);
        await moduleRef
          .get<MigratoryMovementRepository>(MIGRATORY_MOVEMENT_REPOSITORY)
          .insertMissing(records, tx);
      });
    return { reservationRef: reservation.reservationRef, movementIds };
  }

  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: los módulos se importan después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    const { ClockModule } =
      await import('../../../src/infrastructure/out/clock/clock.module.js');
    const { ProcessGuestDataModule } =
      await import('../../../src/application/use-cases/process-guest-data/process-guest-data.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ProcessGuestDataModule,
      ],
      providers: [
        {
          provide: INJECTED_SELECTION,
          inject: [SELECT_FOREIGN_MOVEMENTS],
          useFactory: (injected: SelectForeignMovements) => injected,
        },
      ],
    }).compile();
    selection = moduleRef.get<SelectForeignMovements>(INJECTED_SELECTION);
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('escenario 1: con tres extranjeros y dos colombianos en el periodo, entrega solo los movimientos de los tres, con todos sus datos, el tipo y la fecha', async () => {
    // Una reserva con John (entra y sale) y Ana; otra con Pierre, Andrea y Carlos. Todos los movimientos,
    // ENTRY y DEPARTURE, caen en octubre.
    const first = await stay(
      [JOHN, ANA],
      [
        { documentNumber: 'X99', type: 'ENTRY', date: '2026-10-09' },
        { documentNumber: '123', type: 'ENTRY', date: '2026-10-09' },
        { documentNumber: 'X99', type: 'DEPARTURE', date: '2026-10-12' },
        { documentNumber: '123', type: 'DEPARTURE', date: '2026-10-12' },
      ],
    );
    const second = await stay(
      [PIERRE, ANDREA, CARLOS],
      [
        { documentNumber: 'FR123456', type: 'ENTRY', date: '2026-10-10' },
        { documentNumber: 'V8812345', type: 'ENTRY', date: '2026-10-10' },
        { documentNumber: '1144093552', type: 'ENTRY', date: '2026-10-10' },
      ],
    );
    const id = (
      { movementIds }: { movementIds: Map<string, string> },
      key: string,
    ) => movementIds.get(key);
    const andreaAndPierre = [
      {
        movementId: id(second, 'V8812345 ENTRY'),
        reservationRef: second.reservationRef,
        movementType: 'ENTRY',
        movementDate: '2026-10-10',
        guest: ANDREA,
      },
      {
        movementId: id(second, 'FR123456 ENTRY'),
        reservationRef: second.reservationRef,
        movementType: 'ENTRY',
        movementDate: '2026-10-10',
        guest: PIERRE,
      },
    ].sort((a, b) =>
      a.guest.documentNumber < b.guest.documentNumber ? -1 : 1,
    );

    const movements = await selection.byPeriod(FROM, TO);

    // Orden estable del plan (B2): fecha, reserva, documento y tipo.
    expect(movements).toEqual([
      {
        movementId: id(first, 'X99 ENTRY'),
        reservationRef: first.reservationRef,
        movementType: 'ENTRY',
        movementDate: '2026-10-09',
        guest: JOHN,
      },
      ...andreaAndPierre,
      {
        movementId: id(first, 'X99 DEPARTURE'),
        reservationRef: first.reservationRef,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
        guest: JOHN,
      },
    ]);
    // Los de Ana y Carlos se conservan, pero no se entregan.
    const [{ total }]: { total: number }[] = await dataSource.query(
      'SELECT count(*)::int AS total FROM migratory_movement',
    );
    expect(total).toBe(7);
  });

  it('escenario 1: solo entran los movimientos del periodo pedido, con el primer y el último día incluidos', async () => {
    // John sale el primer día del periodo; Pierre entra el último y sale al día siguiente. La entrada de
    // John es del día anterior.
    await stay(
      [JOHN, PIERRE],
      [
        { documentNumber: 'X99', type: 'ENTRY', date: '2026-09-30' },
        { documentNumber: 'X99', type: 'DEPARTURE', date: '2026-10-01' },
        { documentNumber: 'FR123456', type: 'ENTRY', date: '2026-10-31' },
        { documentNumber: 'FR123456', type: 'DEPARTURE', date: '2026-11-01' },
      ],
    );

    const movements = await selection.byPeriod(FROM, TO);

    expect(
      movements.map(({ guest, movementType, movementDate }) => [
        guest.documentNumber,
        movementType,
        movementDate,
      ]),
    ).toEqual([
      ['X99', 'DEPARTURE', '2026-10-01'],
      ['FR123456', 'ENTRY', '2026-10-31'],
    ]);
  });

  it('escenario 2: con movimientos en el periodo, todos de huéspedes colombianos, entrega una lista vacía', async () => {
    await stay(
      [ANA, CARLOS],
      [
        { documentNumber: '123', type: 'ENTRY', date: '2026-10-09' },
        { documentNumber: '1144093552', type: 'ENTRY', date: '2026-10-09' },
        { documentNumber: '123', type: 'DEPARTURE', date: '2026-10-12' },
      ],
    );

    await expect(selection.byPeriod(FROM, TO)).resolves.toEqual([]);
  });
});
