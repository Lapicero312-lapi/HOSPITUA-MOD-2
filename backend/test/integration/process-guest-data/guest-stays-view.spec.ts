import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CLOCK, type Clock } from '../../../src/application/ports/out/clock.js';
import {
  GUEST_STAY_QUERY,
  type GuestStayQuery,
} from '../../../src/application/ports/out/guest-stay.query.js';
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
import type {
  ReservationStatus,
  StatusReason,
  StayStatus,
} from '../../../src/domain/shared/enums.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../support/builders.js';
import { integrationEnv, truncateAllTables } from '../support/database.js';

/**
 * T018 de `process-guest-data`: los escenarios 1 a 8 de la historia 3 del spec y la fila FR-016 de
 * "Pruebas por escenario" del plan, contra C1 (`GET /api/guest-stays`) y C2
 * (`GET /api/reservations/{reservationRef}/guests/{documentNumber}`). Todo es real: la aplicación completa
 * por HTTP y PostgreSQL. Los huéspedes llegan como los envía el Módulo 1: cada Check-In y cada Check-Out se
 * registra con `RegisterGuestMovements`, el puerto que llama `update-reservation`, en su propia
 * transacción. Solo el reloj es fijo, para que la estadía sin salida quede abierta hasta un día conocido.
 */

/** Hoy: las estadías sin salida llegan hasta este día (plan, "Puntos que este plan propone", punto 5). */
const TODAY = '2026-10-20';
const CLOCK_ON_TODAY: Clock = {
  today: () => TODAY,
  now: () => new Date(`${TODAY}T15:00:00.000Z`),
};

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
const KENJI: GuestPayload = {
  firstName: 'Kenji',
  lastName: 'Tanaka',
  documentType: 'PAS',
  documentNumber: 'TK778812',
  birthDate: '1979-11-02',
  nationality: 'Japón',
  originPlace: 'Tokio, Japón',
  destinationPlace: 'Bogotá, Colombia',
};
const LUCIA: GuestPayload = {
  firstName: 'Lucía',
  lastName: 'Fernández',
  documentType: 'PAS',
  documentNumber: 'ES4471230',
  birthDate: '1992-06-25',
  nationality: 'España',
  originPlace: 'Madrid, España',
  destinationPlace: 'Santa Marta, Colombia',
};
const LUKAS: GuestPayload = {
  firstName: 'Lukas',
  lastName: 'Becker',
  documentType: 'PAS',
  documentNumber: 'C4X8R21K',
  birthDate: '1990-01-30',
  nationality: 'Alemania',
  originPlace: 'Berlín, Alemania',
  destinationPlace: 'Santa Marta, Colombia',
};
const MARIA_JOSE: GuestPayload = {
  firstName: 'María José',
  lastName: 'Ruiz',
  documentType: 'CC',
  documentNumber: '52345678',
  birthDate: '1983-09-08',
  nationality: 'Colombia',
};
const SOFIA: GuestPayload = {
  firstName: 'Sofía',
  lastName: 'Restrepo',
  documentType: 'CC',
  documentNumber: '1020304050',
  birthDate: '2001-04-17',
  nationality: 'Colombia',
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
const EMMA: GuestPayload = {
  firstName: 'Emma',
  lastName: 'Wilson',
  documentType: 'PAS',
  documentNumber: 'UK5521987',
  birthDate: '1996-12-01',
  nationality: 'Reino Unido',
  originPlace: 'Londres, Reino Unido',
  destinationPlace: 'Cartagena, Colombia',
};

/**
 * Las estadías de las pruebas, una reserva por fila, de la entrada más reciente a la más antigua: 12
 * huéspedes en 8 reservas, colombianos y extranjeros, unos en el hotel y otros ya fuera. John y Ana tienen
 * dos estadías cada uno. `endDate` es la salida prevista de la reserva.
 */
const STAYS = {
  johnAndAna: {
    guests: [ANA, JOHN],
    entry: '2026-10-18',
    exit: null,
    endDate: '2026-10-21',
  },
  kenji: {
    guests: [KENJI],
    entry: '2026-10-16',
    exit: null,
    endDate: '2026-10-22',
  },
  luciaAndLukas: {
    guests: [LUCIA, LUKAS],
    entry: '2026-10-14',
    exit: '2026-10-17',
    endDate: '2026-10-17',
  },
  mariaJoseAndSofia: {
    guests: [MARIA_JOSE, SOFIA],
    entry: '2026-10-09',
    exit: null,
    endDate: '2026-10-24',
  },
  pierreAndCarlos: {
    guests: [PIERRE, CARLOS],
    entry: '2026-10-05',
    exit: '2026-10-08',
    endDate: '2026-10-08',
  },
  emma: {
    guests: [EMMA],
    entry: '2026-10-01',
    exit: '2026-10-03',
    endDate: '2026-10-03',
  },
  johnInSeptember: {
    guests: [JOHN],
    entry: '2026-09-20',
    exit: '2026-09-23',
    endDate: '2026-09-23',
  },
  anaInSeptember: {
    guests: [ANA],
    entry: '2026-09-10',
    exit: '2026-09-12',
    endDate: '2026-09-12',
  },
} satisfies Record<
  string,
  {
    guests: GuestPayload[];
    entry: string;
    exit: string | null;
    endDate: string;
  }
>;
type StayKey = keyof typeof STAYS;

/**
 * FR-016: una reserva en cada estado sin Check-In, cada una con su titular. Ninguna tiene huéspedes en la
 * vista. Los documentos de los titulares no son de ningún huésped de `STAYS`.
 */
const WITHOUT_CHECK_IN: {
  status: ReservationStatus;
  statusReason: StatusReason | null;
  stayStatus: StayStatus;
  documentNumber: string;
}[] = [
  {
    status: 'CANCELLED',
    statusReason: 'CANCELLED_BY_RECEPTION',
    stayStatus: 'EXPECTED',
    documentNumber: '79123456',
  },
  {
    status: 'NO_SHOW',
    statusReason: 'DAY_CLOSE_NO_SHOW',
    stayStatus: 'NOT_ARRIVED',
    documentNumber: '79234567',
  },
  {
    status: 'PENDING',
    statusReason: null,
    stayStatus: 'EXPECTED',
    documentNumber: '79345678',
  },
  {
    status: 'ACTIVE',
    statusReason: null,
    stayStatus: 'EXPECTED',
    documentNumber: '79456789',
  },
];

const NO_RESULTS_MESSAGE = 'No hay huéspedes que coincidan con los filtros.';

describe('Vista de huéspedes alojados: escenarios 1 a 8 de la historia 3 (T018)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  /** Las reservas de `STAYS`, ya guardadas, con su `reservationRef`. */
  const reservations = {} as Record<StayKey, Reservation>;
  /** Las reservas de `WITHOUT_CHECK_IN`, ya guardadas. */
  const reservationsWithoutCheckIn: Reservation[] = [];

  const guestStays = (query: Record<string, string> = {}) =>
    request(app.getHttpServer()).get('/api/guest-stays').query(query);

  /** La fila de C1 que debe tener `guest` en la reserva `key`, con la marca de extranjero indicada. */
  function row(key: StayKey, guest: GuestPayload, isForeign: boolean) {
    const { entry, exit } = STAYS[key];
    return {
      reservationRef: reservations[key].reservationRef,
      guest: {
        firstName: guest.firstName,
        lastName: guest.lastName,
        documentType: guest.documentType,
        documentNumber: guest.documentNumber,
        nationality: guest.nationality,
        isForeign,
      },
      entryDate: entry,
      exitDate: exit,
      inHotel: exit === null,
    };
  }

  // Las filas, con el nombre de la reserva y del huésped. Los colombianos no tienen la marca de extranjero.
  const anaNow = () => row('johnAndAna', ANA, false);
  const johnNow = () => row('johnAndAna', JOHN, true);
  const kenji = () => row('kenji', KENJI, true);
  const lukas = () => row('luciaAndLukas', LUKAS, true);
  const lucia = () => row('luciaAndLukas', LUCIA, true);
  const sofia = () => row('mariaJoseAndSofia', SOFIA, false);
  const mariaJose = () => row('mariaJoseAndSofia', MARIA_JOSE, false);
  const carlos = () => row('pierreAndCarlos', CARLOS, false);
  const pierre = () => row('pierreAndCarlos', PIERRE, true);
  const emma = () => row('emma', EMMA, true);
  const johnInSeptember = () => row('johnInSeptember', JOHN, true);
  const anaInSeptember = () => row('anaInSeptember', ANA, false);

  /** La respuesta 200 de C1 con esas filas, todas en la página 1. */
  const onePage = (items: unknown[]) => ({
    items,
    page: 1,
    pageSize: 10,
    totalItems: items.length,
    totalPages: 1,
    message: null,
  });

  /** La respuesta 200 de C1 sin resultados (escenario 7). */
  const noResults = {
    items: [],
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
    message: NO_RESULTS_MESSAGE,
  };

  // Arrancar la aplicación y cargar los huéspedes tarda: se hace una sola vez. Ninguna prueba escribe.
  beforeAll(async () => {
    // AppConfigModule lee el entorno al importarse: AppModule se importa después de asignarlo.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(CLOCK_ON_TODAY)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    dataSource = app.get(DataSource);
    await truncateAllTables(dataSource);

    const reservationRepository = app.get<ReservationRepository>(
      RESERVATION_REPOSITORY,
    );
    const registration = app.get<RegisterGuestMovements>(
      REGISTER_GUEST_MOVEMENTS,
    );
    const transactions = app.get<TransactionRunner>(TRANSACTION_RUNNER);

    for (const [key, stay] of Object.entries(STAYS) as [
      StayKey,
      (typeof STAYS)[StayKey],
    ][]) {
      const checkedOut = stay.exit !== null;
      const reservation = await reservationRepository.insert(
        aDirectReservation({
          startDate: stay.entry,
          endDate: stay.endDate,
          status: checkedOut ? 'COMPLETED' : 'IN_PROGRESS',
          statusReason: checkedOut ? 'CHECK_OUT' : 'CHECK_IN',
          rooms: [
            aDirectRoom({
              stayStatus: checkedOut ? 'CHECKED_OUT' : 'CHECKED_IN',
            }),
          ],
        }),
      );
      reservations[key] = reservation;
      const roomId = reservation.rooms[0].roomId as string;
      // El Check-In y, si ya salió, el Check-Out, cada uno en su transacción, como el consumidor.
      await transactions.run((tx) =>
        registration.register(tx, {
          reservationId: reservation.id,
          roomId,
          movementType: 'ENTRY',
          movementDate: stay.entry,
          guests: stay.guests,
        }),
      );
      if (stay.exit !== null) {
        const exit = stay.exit;
        await transactions.run((tx) =>
          registration.register(tx, {
            reservationId: reservation.id,
            roomId,
            movementType: 'DEPARTURE',
            movementDate: exit,
            guests: stay.guests,
          }),
        );
      }
    }

    for (const withoutCheckIn of WITHOUT_CHECK_IN) {
      reservationsWithoutCheckIn.push(
        await reservationRepository.insert(
          aDirectReservation({
            status: withoutCheckIn.status,
            statusReason: withoutCheckIn.statusReason,
            rooms: [aDirectRoom({ stayStatus: withoutCheckIn.stayStatus })],
            guest: aGuest({ documentNumber: withoutCheckIn.documentNumber }),
          }),
        ),
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource) {
      await truncateAllTables(dataSource);
    }
    await app?.close();
  });

  describe('escenario 1: listado', () => {
    it('la página 1 trae 10 huéspedes, de la entrada más reciente a la más antigua, cada uno con su reserva, sus datos y su entrada, y "En el hotel" (sin salida) los que no han salido', async () => {
      const res = await guestStays();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          anaNow(),
          johnNow(),
          kenji(),
          lukas(),
          lucia(),
          sofia(),
          mariaJose(),
          carlos(),
          pierre(),
          emma(),
        ],
        page: 1,
        pageSize: 10,
        totalItems: 12,
        totalPages: 2,
        message: null,
      });
    });

    it('la página 2 trae los otros dos: las estadías de septiembre de John y de Ana', async () => {
      const res = await guestStays({ page: '2' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [johnInSeptember(), anaInSeptember()],
        page: 2,
        pageSize: 10,
        totalItems: 12,
        totalPages: 2,
        message: null,
      });
    });
  });

  describe('escenario 2: filtrar por extranjeros o colombianos', () => {
    it('FOREIGN: solo los de nacionalidad distinta de Colombia', async () => {
      const res = await guestStays({ nationality: 'FOREIGN' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        onePage([
          johnNow(),
          kenji(),
          lukas(),
          lucia(),
          pierre(),
          emma(),
          johnInSeptember(),
        ]),
      );
    });

    it('COLOMBIAN: solo los de nacionalidad Colombia', async () => {
      const res = await guestStays({ nationality: 'COLOMBIAN' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        onePage([anaNow(), sofia(), mariaJose(), carlos(), anaInSeptember()]),
      );
    });
  });

  describe('escenario 3: filtrar quién está en el hotel', () => {
    it('IN_HOTEL ("En el hotel"): solo los que tienen entrada y todavía no tienen salida', async () => {
      const res = await guestStays({ presence: 'IN_HOTEL' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        onePage([anaNow(), johnNow(), kenji(), sofia(), mariaJose()]),
      );
    });

    it('CHECKED_OUT ("Ya salió"): solo los que ya tienen salida', async () => {
      const res = await guestStays({ presence: 'CHECKED_OUT' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        onePage([
          lukas(),
          lucia(),
          carlos(),
          pierre(),
          emma(),
          johnInSeptember(),
          anaInSeptember(),
        ]),
      );
    });
  });

  it('escenario 4: con el rango del 15 al 17 de octubre, solo los huéspedes cuya estadía se cruza con él', async () => {
    // Entran: Kenji (entró el 16 y sigue en el hotel), Lucía y Lukas (del 14 al 17) y Sofía y María José
    // (desde el 9, siguen en el hotel: su estadía llega hasta hoy). Quedan fuera John y Ana, que entraron
    // el 18, un día después del rango, y los que salieron antes del 15.
    const res = await guestStays({
      dateFrom: '2026-10-15',
      dateTo: '2026-10-17',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      onePage([kenji(), lukas(), lucia(), sofia(), mariaJose()]),
    );
  });

  describe('escenario 5: búsqueda por documento o por nombre', () => {
    it('por documento, X99: las dos estadías de John, una por reserva', async () => {
      const res = await guestStays({ search: 'X99' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(onePage([johnNow(), johnInSeptember()]));
    });

    it('por documento la coincidencia es exacta: X9 no encuentra a John', async () => {
      const res = await guestStays({ search: 'X9' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(noResults);
    });

    it.each([
      ['perez', 'Ana Pérez, sin tilde', () => [anaNow(), anaInSeptember()]],
      ['PÉREZ', 'Ana Pérez, en mayúsculas', () => [anaNow(), anaInSeptember()]],
      ['jose', 'María José, sin tilde', () => [mariaJose()]],
      [
        'smi',
        'John Smith, por 3 letras del apellido',
        () => [johnNow(), johnInSeptember()],
      ],
    ])(
      'por nombre, parcial y sin distinguir mayúsculas ni tildes: "%s" encuentra a %s',
      async (search, _who, expected) => {
        const res = await guestStays({ search });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(onePage(expected()));
      },
    );
  });

  describe('escenario 6: detalle de un huésped (C2)', () => {
    it('trae todos sus datos, el enlace a la reserva y sus movimientos de entrada y salida con su fecha', async () => {
      const { reservationRef } = reservations.johnInSeptember;

      const res = await request(app.getHttpServer()).get(
        `/api/reservations/${reservationRef}/guests/X99`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        reservationRef,
        reservationLink: `/api/reservations/${reservationRef}`,
        guest: {
          documentType: 'PAS',
          documentNumber: 'X99',
          firstName: 'John',
          lastName: 'Smith',
          birthDate: '1990-05-12',
          nationality: 'Estados Unidos',
          isForeign: true,
          originPlace: 'Miami, Estados Unidos',
          destinationPlace: 'Cartagena, Colombia',
        },
        movements: [
          { movementType: 'ENTRY', movementDate: '2026-09-20' },
          { movementType: 'DEPARTURE', movementDate: '2026-09-23' },
        ],
      });
    });

    it('lo vacío viaja null (la pantalla muestra "—"): Ana, colombiana, no tiene procedencia ni destino, y como sigue en el hotel solo tiene la entrada', async () => {
      const { reservationRef } = reservations.johnAndAna;

      const res = await request(app.getHttpServer()).get(
        `/api/reservations/${reservationRef}/guests/123`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        reservationRef,
        reservationLink: `/api/reservations/${reservationRef}`,
        guest: {
          documentType: 'CC',
          documentNumber: '123',
          firstName: 'Ana',
          lastName: 'Pérez',
          birthDate: '1995-03-20',
          nationality: 'Colombia',
          isForeign: false,
          originPlace: null,
          destinationPlace: null,
        },
        movements: [{ movementType: 'ENTRY', movementDate: '2026-10-18' }],
      });
    });
  });

  it('escenario 7: con filtros que nadie cumple (colombianos con el documento de John), 200, la lista vacía y el mensaje del spec', async () => {
    const res = await guestStays({ nationality: 'COLOMBIAN', search: 'X99' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(noResults);
  });

  describe('escenario 8: filtros inválidos', () => {
    it.each([
      [
        { nationality: 'OTRA' },
        'INVALID_NATIONALITY_FILTER',
        'El filtro de nacionalidad no es válido.',
      ],
      [
        { presence: 'OTRA' },
        'INVALID_PRESENCE_FILTER',
        'El filtro de situación no es válido.',
      ],
      [
        { dateFrom: '2026-02-30', dateTo: '2026-03-01' },
        'INVALID_DATE',
        'La fecha indicada no es válida.',
      ],
      [
        { dateFrom: '2026-10-15' },
        'INCOMPLETE_DATE_RANGE',
        'Debe completar ambas fechas del rango.',
      ],
      [
        { dateFrom: '2026-10-17', dateTo: '2026-10-15' },
        'INVALID_DATE_RANGE',
        'La fecha inicial no puede ser posterior a la fecha final.',
      ],
      [
        { dateFrom: '2026-01-01', dateTo: '2027-01-02' },
        'DATE_RANGE_TOO_LARGE',
        'El rango de fechas no puede superar 366 días.',
      ],
      [
        { search: 'jo' },
        'NAME_SEARCH_TOO_SHORT',
        'La búsqueda por nombre requiere al menos 3 caracteres.',
      ],
      [{ search: 'smith;' }, 'INVALID_SEARCH', 'La búsqueda no es válida.'],
      [
        { page: '0' },
        'INVALID_PAGE',
        'El número de página debe ser 1 o mayor.',
      ],
    ])(
      '%o: 400 %s con su mensaje, sin consultar',
      async (query, errorCode, message) => {
        const guestStayQuery = app.get<GuestStayQuery>(GUEST_STAY_QUERY);
        const count = vi.spyOn(guestStayQuery, 'count');
        const findPage = vi.spyOn(guestStayQuery, 'findPage');

        const res = await guestStays(query);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          errorCode,
          message,
          timestamp: expect.any(String),
          path: '/api/guest-stays',
        });
        expect(count).not.toHaveBeenCalled();
        expect(findPage).not.toHaveBeenCalled();
      },
    );
  });

  it('FR-016: los titulares de las reservas CANCELLED, NO_SHOW, PENDING y ACTIVE sin Check-In no aparecen, ni en el listado ni al buscarlos', async () => {
    const refsWithoutCheckIn = reservationsWithoutCheckIn.map(
      ({ reservationRef }) => reservationRef,
    );
    const listed = [
      ...(await guestStays()).body.items,
      ...(await guestStays({ page: '2' })).body.items,
    ].map(({ reservationRef }: { reservationRef: string }) => reservationRef);

    expect(listed).toHaveLength(12);
    expect(listed.filter((ref) => refsWithoutCheckIn.includes(ref))).toEqual(
      [],
    );
    for (const { documentNumber } of WITHOUT_CHECK_IN) {
      const res = await guestStays({ search: documentNumber });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(noResults);
    }
  });
});
