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
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import {
  type GuestPayload,
  REGISTER_GUEST_MOVEMENTS,
  type RegisterGuestMovements,
  type RegisterGuestMovementsCommand,
  type RegistrationSummary,
} from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
} from '../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { aDirectReservation, aDirectRoom } from '../../support/builders.js';
import { captureLogs } from '../support/capture-logs.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T009 de `process-guest-data`: los escenarios 1 a 5 (incluido el 3a) de la historia 1 del spec y sus
 * casos borde, con los datos de la tabla "Pruebas por escenario" del plan. Todo es real:
 * `ProcessGuestDataModule` con `RegisterGuestMovements` y `SelectForeignMovements` inyectados desde fuera,
 * como los usarán `update-reservation` y `export-sire-file`, los repositorios y PostgreSQL. Cada
 * notificación se registra en una transacción, como la del consumidor (plan, B1 y D1).
 */

const CHECK_IN_DATE = '2026-10-09';
const CHECK_OUT_DATE = '2026-10-12';

/** Ana y John, del mensaje de Check-In del plan de `update-reservation`. Ana no trae procedencia ni destino. */
const ANA: GuestPayload = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};
const JOHN: GuestPayload = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};
const PIERRE: GuestPayload = {
  firstName: 'Pierre',
  lastName: 'Dubois',
  documentType: 'PAS',
  documentNumber: 'FR123456',
  birthDate: '1985-02-03',
  nationality: 'Francia',
  originPlace: 'París, Francia',
  destinationPlace: 'Medellín, Colombia',
};
const CARLOS: GuestPayload = {
  firstName: 'Carlos',
  lastName: 'Gómez',
  documentType: 'CC',
  documentNumber: '1144093552',
  birthDate: '1988-07-14',
  nationality: 'Colombia',
};

/** Una fila de `guest_data` con la referencia de su reserva, sin el id ni la fecha de creación. */
type StoredGuest = {
  reservation_ref: string;
  document_type: string;
  document_number: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  nationality: string;
  origin_place: string | null;
  destination_place: string | null;
};

/** Cómo debe quedar guardado un huésped completo: tal como llegó (FR-004). */
function storedAs(reservationRef: string, guest: GuestPayload): StoredGuest {
  return {
    reservation_ref: reservationRef,
    document_type: guest.documentType as string,
    document_number: guest.documentNumber as string,
    first_name: guest.firstName as string,
    last_name: guest.lastName as string,
    birth_date: guest.birthDate as string,
    nationality: guest.nationality as string,
    origin_place: guest.originPlace ?? null,
    destination_place: guest.destinationPlace ?? null,
  };
}

/** La habitación asignada de la reserva (las del constructor de pruebas siempre tienen una). */
function roomIdOf(reservation: Reservation, index = 0): string {
  const { roomId } = reservation.rooms[index];
  if (roomId === null) {
    throw new Error('La habitación de prueba no tiene roomId.');
  }
  return roomId;
}

describe('RegisterGuestMovements contra PostgreSQL real (T009, historia 1)', () => {
  let moduleRef: TestingModule;
  let registration: RegisterGuestMovements;
  let selection: SelectForeignMovements;
  let transactions: TransactionRunner;
  let dataSource: DataSource;

  /** Una reserva guardada, con una habitación (la 201, para 2 huéspedes) salvo que se pidan otras. */
  async function aStoredReservation(
    rooms = [aDirectRoom()],
  ): Promise<Reservation> {
    return moduleRef
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation({ rooms }));
  }

  /** Registra una notificación en su propia transacción, como el consumidor. */
  function notify(
    reservation: Reservation,
    changes: Partial<RegisterGuestMovementsCommand>,
  ): Promise<RegistrationSummary> {
    return transactions.run((tx) =>
      registration.register(tx, {
        reservationId: reservation.id,
        roomId: roomIdOf(reservation),
        movementType: 'ENTRY',
        movementDate: CHECK_IN_DATE,
        guests: [],
        ...changes,
      }),
    );
  }

  const checkIn = (reservation: Reservation, guests: GuestPayload[]) =>
    notify(reservation, { guests });

  const checkOut = (reservation: Reservation, guests: GuestPayload[]) =>
    notify(reservation, {
      movementType: 'DEPARTURE',
      movementDate: CHECK_OUT_DATE,
      guests,
    });

  /** Todos los `guest_data`, por reserva y documento. */
  const storedGuests = (): Promise<StoredGuest[]> =>
    dataSource.query(
      `SELECT r.reservation_ref, gd.document_type, gd.document_number, gd.first_name, gd.last_name,
              gd.birth_date::text AS birth_date, gd.nationality, gd.origin_place, gd.destination_place
       FROM guest_data gd
       JOIN reservation r ON r.id = gd.reservation_id
       ORDER BY r.reservation_ref, gd.document_number`,
    );

  /**
   * Todos los movimientos, como `reserva documento tipo fecha`, por reserva, documento y tipo (`ENTRY`
   * antes que `DEPARTURE`).
   */
  const storedMovements = async (): Promise<string[]> => {
    const rows: {
      reservation_ref: string;
      document_number: string;
      movement_type: string;
      movement_date: string;
    }[] = await dataSource.query(
      `SELECT r.reservation_ref, gd.document_number, mm.movement_type,
              mm.movement_date::text AS movement_date
       FROM migratory_movement mm
       JOIN guest_data gd ON gd.id = mm.guest_data_id
       JOIN reservation r ON r.id = gd.reservation_id
       ORDER BY r.reservation_ref, gd.document_number, mm.movement_type = 'DEPARTURE'`,
    );
    return rows.map(
      (row) =>
        `${row.reservation_ref} ${row.document_number} ${row.movement_type} ${row.movement_date}`,
    );
  };

  /** Los documentos y el tipo de lo que entregaría la selección del SIRE para octubre. */
  const sireOfOctober = async (): Promise<string[]> =>
    (await selection.byPeriod('2026-10-01', '2026-10-31')).map(
      ({ guest, movementType }) => `${guest.documentNumber} ${movementType}`,
    );

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
    const INJECTED_REGISTRATION = Symbol('INJECTED_REGISTRATION');
    const INJECTED_SELECTION = Symbol('INJECTED_SELECTION');
    moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        PersistenceModule,
        ClockModule,
        ProcessGuestDataModule,
      ],
      providers: [
        {
          provide: INJECTED_REGISTRATION,
          inject: [REGISTER_GUEST_MOVEMENTS],
          useFactory: (injected: RegisterGuestMovements) => injected,
        },
        {
          provide: INJECTED_SELECTION,
          inject: [SELECT_FOREIGN_MOVEMENTS],
          useFactory: (injected: SelectForeignMovements) => injected,
        },
      ],
    }).compile();
    registration = moduleRef.get<RegisterGuestMovements>(INJECTED_REGISTRATION);
    selection = moduleRef.get<SelectForeignMovements>(INJECTED_SELECTION);
    transactions = moduleRef.get<TransactionRunner>(TRANSACTION_RUNNER);
    dataSource = moduleRef.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('prueba independiente de la historia 1: Check-In de tres huéspedes (dos extranjeros), su Check-Out y un reenvío, sin duplicados', async () => {
    const reservation = await aStoredReservation();
    const ref = reservation.reservationRef;
    const guests = [JOHN, ANA, PIERRE];

    await expect(checkIn(reservation, guests)).resolves.toMatchObject({
      received: 3,
      registered: 3,
      foreign: 2,
    });
    await expect(checkOut(reservation, guests)).resolves.toMatchObject({
      received: 3,
      registered: 3,
      alreadyRegistered: 0,
    });
    await expect(checkOut(reservation, guests)).resolves.toEqual({
      received: 3,
      registered: 0,
      alreadyRegistered: 3,
      foreign: 2,
      skipped: 0,
    });

    await expect(storedGuests()).resolves.toHaveLength(3);
    await expect(storedMovements()).resolves.toEqual([
      `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
      `${ref} 123 DEPARTURE ${CHECK_OUT_DATE}`,
      `${ref} FR123456 ENTRY ${CHECK_IN_DATE}`,
      `${ref} FR123456 DEPARTURE ${CHECK_OUT_DATE}`,
      `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
      `${ref} X99 DEPARTURE ${CHECK_OUT_DATE}`,
    ]);
  });

  it('escenario 1: el Check-In registra un ENTRY por huésped, colombiano o extranjero, con sus datos tal como llegaron', async () => {
    const reservation = await aStoredReservation();
    const ref = reservation.reservationRef;

    await expect(checkIn(reservation, [ANA, JOHN])).resolves.toEqual({
      received: 2,
      registered: 2,
      alreadyRegistered: 0,
      foreign: 1,
      skipped: 0,
    });

    await expect(storedGuests()).resolves.toEqual([
      storedAs(ref, ANA),
      storedAs(ref, JOHN),
    ]);
    await expect(storedMovements()).resolves.toEqual([
      `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
      `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
    ]);
  });

  it('escenario 2: con tres personas, dos extranjeras, registra tres ENTRY y reconoce como extranjeros solo a las dos', async () => {
    const reservation = await aStoredReservation();
    const ref = reservation.reservationRef;

    await expect(checkIn(reservation, [JOHN, ANA, PIERRE])).resolves.toEqual({
      received: 3,
      registered: 3,
      alreadyRegistered: 0,
      foreign: 2,
      skipped: 0,
    });

    await expect(storedMovements()).resolves.toEqual([
      `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
      `${ref} FR123456 ENTRY ${CHECK_IN_DATE}`,
      `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
    ]);
    await expect(sireOfOctober()).resolves.toEqual([
      'FR123456 ENTRY',
      'X99 ENTRY',
    ]);
  });

  it('escenarios 3 y 3a: el Check-Out registra un DEPARTURE por huésped en su mismo GuestData, sin tocar el ENTRY ni los datos aunque traiga otros', async () => {
    const reservation = await aStoredReservation();
    const ref = reservation.reservationRef;
    await checkIn(reservation, [ANA, JOHN]);
    const logs = captureLogs();

    await expect(
      checkOut(reservation, [
        { ...ANA, lastName: 'Pérez Gómez', birthDate: '1995-03-21' },
        { ...JOHN, nationality: 'Canadá', destinationPlace: 'Bogotá' },
      ]),
    ).resolves.toEqual({
      received: 2,
      registered: 2,
      alreadyRegistered: 0,
      foreign: 1,
      skipped: 0,
    });

    // Un solo GuestData por huésped, con los datos del Check-In (FR-017).
    await expect(storedGuests()).resolves.toEqual([
      storedAs(ref, ANA),
      storedAs(ref, JOHN),
    ]);
    await expect(storedMovements()).resolves.toEqual([
      `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
      `${ref} 123 DEPARTURE ${CHECK_OUT_DATE}`,
      `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
      `${ref} X99 DEPARTURE ${CHECK_OUT_DATE}`,
    ]);
    // Los dos tenían entrada: no hay aviso de salida sin entrada.
    expect(logs).toEqual([]);
  });

  it('escenario 4: una reserva solo de colombianos registra sus movimientos, pero ninguno entra a la selección del SIRE', async () => {
    const reservation = await aStoredReservation();
    const ref = reservation.reservationRef;

    await expect(checkIn(reservation, [ANA, CARLOS])).resolves.toMatchObject({
      registered: 2,
      foreign: 0,
    });
    await checkOut(reservation, [ANA, CARLOS]);

    await expect(storedMovements()).resolves.toEqual([
      `${ref} 1144093552 ENTRY ${CHECK_IN_DATE}`,
      `${ref} 1144093552 DEPARTURE ${CHECK_OUT_DATE}`,
      `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
      `${ref} 123 DEPARTURE ${CHECK_OUT_DATE}`,
    ]);
    await expect(sireOfOctober()).resolves.toEqual([]);
  });

  describe('escenario 5: la notificación repetida', () => {
    it('el mismo Check-In dos veces no duplica ni modifica nada', async () => {
      const reservation = await aStoredReservation();
      await checkIn(reservation, [ANA, JOHN]);
      const before = {
        guests: await storedGuests(),
        movements: await storedMovements(),
      };

      await expect(checkIn(reservation, [ANA, JOHN])).resolves.toEqual({
        received: 2,
        registered: 0,
        alreadyRegistered: 2,
        foreign: 1,
        skipped: 0,
      });

      await expect(storedGuests()).resolves.toEqual(before.guests);
      await expect(storedMovements()).resolves.toEqual(before.movements);
    });

    it('el mismo Check-Out dos veces, aunque la segunda traiga otra fecha, deja un solo DEPARTURE con la primera', async () => {
      const reservation = await aStoredReservation();
      const ref = reservation.reservationRef;
      await checkIn(reservation, [JOHN]);
      await checkOut(reservation, [JOHN]);

      await expect(
        notify(reservation, {
          movementType: 'DEPARTURE',
          movementDate: '2026-10-13',
          guests: [JOHN],
        }),
      ).resolves.toMatchObject({ registered: 0, alreadyRegistered: 1 });

      await expect(storedMovements()).resolves.toEqual([
        `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
        `${ref} X99 DEPARTURE ${CHECK_OUT_DATE}`,
      ]);
    });
  });

  describe('casos borde', () => {
    it('el mismo huésped repetido en la notificación se procesa una sola vez, con los datos del primero', async () => {
      const reservation = await aStoredReservation();
      const ref = reservation.reservationRef;

      await expect(
        checkIn(reservation, [JOHN, ANA, { ...JOHN, firstName: 'Johnny' }]),
      ).resolves.toEqual({
        received: 2,
        registered: 2,
        alreadyRegistered: 0,
        foreign: 1,
        skipped: 0,
      });

      await expect(storedGuests()).resolves.toEqual([
        storedAs(ref, ANA),
        storedAs(ref, JOHN),
      ]);
      await expect(storedMovements()).resolves.toHaveLength(2);
    });

    it('con más huéspedes que el guestCount de la habitación, se registran todos', async () => {
      // La 201 es para 2 huéspedes; llegan 4.
      const reservation = await aStoredReservation([
        aDirectRoom({ guestCount: 2 }),
      ]);

      await expect(
        checkIn(reservation, [ANA, JOHN, PIERRE, CARLOS]),
      ).resolves.toMatchObject({ received: 4, registered: 4, skipped: 0 });

      await expect(storedGuests()).resolves.toHaveLength(4);
      await expect(storedMovements()).resolves.toHaveLength(4);
    });

    it('el cambio de habitación deja un solo ENTRY y un solo DEPARTURE por huésped en la reserva', async () => {
      const reservation = await aStoredReservation([
        aDirectRoom({ roomNumber: '201' }),
        aDirectRoom({ roomNumber: '202' }),
      ]);
      const ref = reservation.reservationRef;
      const [room201, room202] = [
        roomIdOf(reservation, 0),
        roomIdOf(reservation, 1),
      ];
      // John entra en la 201 y se pasa a la 202, donde llega con Pierre.
      await notify(reservation, { roomId: room201, guests: [JOHN] });

      await expect(
        notify(reservation, {
          roomId: room202,
          movementDate: '2026-10-10',
          guests: [JOHN, PIERRE],
        }),
      ).resolves.toMatchObject({ registered: 1, alreadyRegistered: 1 });
      await notify(reservation, {
        roomId: room201,
        movementType: 'DEPARTURE',
        movementDate: '2026-10-10',
        guests: [JOHN],
      });
      await expect(
        notify(reservation, {
          roomId: room202,
          movementType: 'DEPARTURE',
          movementDate: CHECK_OUT_DATE,
          guests: [JOHN, PIERRE],
        }),
      ).resolves.toMatchObject({ registered: 1, alreadyRegistered: 1 });

      await expect(storedGuests()).resolves.toHaveLength(2);
      await expect(storedMovements()).resolves.toEqual([
        `${ref} FR123456 ENTRY 2026-10-10`,
        `${ref} FR123456 DEPARTURE ${CHECK_OUT_DATE}`,
        `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
        `${ref} X99 DEPARTURE 2026-10-10`,
      ]);
    });

    it('otra estadía del mismo huésped tiene sus propios datos y movimientos, sin sobrescribir los de la anterior', async () => {
      const september = await aStoredReservation();
      const october = await aStoredReservation();
      await notify(september, { movementDate: '2026-09-01', guests: [JOHN] });
      await notify(september, {
        movementType: 'DEPARTURE',
        movementDate: '2026-09-03',
        guests: [JOHN],
      });

      await expect(
        checkIn(october, [{ ...JOHN, destinationPlace: 'Bogotá, Colombia' }]),
      ).resolves.toMatchObject({ registered: 1, alreadyRegistered: 0 });

      const byRef = (rows: string[], ref: string) =>
        rows.filter((row) => row.startsWith(ref));
      const movements = await storedMovements();
      expect(byRef(movements, september.reservationRef)).toEqual([
        `${september.reservationRef} X99 ENTRY 2026-09-01`,
        `${september.reservationRef} X99 DEPARTURE 2026-09-03`,
      ]);
      expect(byRef(movements, october.reservationRef)).toEqual([
        `${october.reservationRef} X99 ENTRY ${CHECK_IN_DATE}`,
      ]);
      const guests = await storedGuests();
      expect(
        guests.find(
          ({ reservation_ref }) => reservation_ref === september.reservationRef,
        ),
      ).toEqual(storedAs(september.reservationRef, JOHN));
      expect(
        guests.find(
          ({ reservation_ref }) => reservation_ref === october.reservationRef,
        ),
      ).toEqual(
        storedAs(october.reservationRef, {
          ...JOHN,
          destinationPlace: 'Bogotá, Colombia',
        }),
      );
    });

    it('un huésped con nacionalidad vacía se registra, pero no se trata como extranjero ni entra a la selección del SIRE', async () => {
      const reservation = await aStoredReservation();
      const ref = reservation.reservationRef;
      const withoutNationality = { ...PIERRE, nationality: '' };

      await expect(
        checkIn(reservation, [withoutNationality, JOHN]),
      ).resolves.toMatchObject({ registered: 2, foreign: 1, skipped: 0 });

      await expect(storedGuests()).resolves.toEqual([
        storedAs(ref, withoutNationality),
        storedAs(ref, JOHN),
      ]);
      await expect(sireOfOctober()).resolves.toEqual(['X99 ENTRY']);
    });

    it('al huésped sin un dato exigido se lo omite, con una alerta sin datos personales, y los demás se registran', async () => {
      const reservation = await aStoredReservation();
      const ref = reservation.reservationRef;
      const { birthDate: _birthDate, ...pierreWithoutBirthDate } = PIERRE;
      const logs = captureLogs();

      await expect(
        checkIn(reservation, [ANA, pierreWithoutBirthDate, JOHN]),
      ).resolves.toEqual({
        received: 3,
        registered: 2,
        alreadyRegistered: 0,
        foreign: 2,
        skipped: 1,
      });

      await expect(storedGuests()).resolves.toEqual([
        storedAs(ref, ANA),
        storedAs(ref, JOHN),
      ]);
      await expect(storedMovements()).resolves.toEqual([
        `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
        `${ref} X99 ENTRY ${CHECK_IN_DATE}`,
      ]);
      expect(logs).toEqual([
        `Se omitió al huésped 2 de la notificación (reserva ${ref}, habitación ${roomIdOf(reservation)}) porque le falta: birthDate.`,
      ]);
      for (const personal of ['Pierre', 'Dubois', 'FR123456', '1985-02-03']) {
        expect(logs.join('\n')).not.toContain(personal);
      }
    });

    it('un DEPARTURE sin ENTRY crea el GuestData con los datos del mensaje, registra la salida y deja un aviso', async () => {
      const reservation = await aStoredReservation();
      const ref = reservation.reservationRef;
      await checkIn(reservation, [ANA]);
      const logs = captureLogs();

      await expect(checkOut(reservation, [ANA, JOHN])).resolves.toMatchObject({
        registered: 2,
        alreadyRegistered: 0,
      });

      await expect(storedGuests()).resolves.toEqual([
        storedAs(ref, ANA),
        storedAs(ref, JOHN),
      ]);
      await expect(storedMovements()).resolves.toEqual([
        `${ref} 123 ENTRY ${CHECK_IN_DATE}`,
        `${ref} 123 DEPARTURE ${CHECK_OUT_DATE}`,
        `${ref} X99 DEPARTURE ${CHECK_OUT_DATE}`,
      ]);
      expect(logs).toEqual([
        `Se registró la salida del huésped 2 de la notificación (reserva ${ref}, habitación ${roomIdOf(reservation)}) sin una entrada registrada.`,
      ]);
    });

    it('si la transacción del consumidor se revierte, no queda nada registrado', async () => {
      const reservation = await aStoredReservation();

      await expect(
        transactions.run(async (tx) => {
          await registration.register(tx, {
            reservationId: reservation.id,
            roomId: roomIdOf(reservation),
            movementType: 'ENTRY',
            movementDate: CHECK_IN_DATE,
            guests: [ANA, JOHN],
          });
          throw new Error('falla después de registrar');
        }),
      ).rejects.toThrow('falla después de registrar');

      await expect(storedGuests()).resolves.toEqual([]);
      await expect(storedMovements()).resolves.toEqual([]);
    });
  });
});
