import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  SIRE_EXPORT_REPOSITORY,
  type SireExportRepository,
} from '../../../src/application/ports/out/sire-export.repository.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
  type SireMovement,
} from '../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import type { GuestPayload } from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
} from '../../support/builders.js';
import { startSireApp } from '../support/sire.js';

/**
 * T013 de `export-sire-file`: los casos borde del spec, con las filas de "Pruebas por escenario" del plan.
 * Todo es real: la aplicación completa por HTTP, PostgreSQL y la configuración por defecto de pruebas
 * (`SIRE_MAX_CONCURRENT` = 3). Solo se intercepta `SelectForeignMovements` o el registro cuando el caso pide
 * saber si se consultó, retener una exportación en curso o fallar a mitad del proceso.
 */

const MESSAGES = {
  PERIOD_TOO_LARGE:
    'El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos.',
  INVALID_GUEST_CHARACTERS: 'Caracteres no válidos en el registro del huésped.',
};

/** Lukas, del wireframe. */
const LUKAS: GuestPayload = {
  firstName: 'Lukas',
  lastName: 'Becker',
  documentType: 'PAS',
  documentNumber: 'C4X8R21K',
  birthDate: '1991-07-02',
  nationality: 'Alemania',
  originPlace: 'Berlín, Alemania',
  destinationPlace: 'Medellín, Colombia',
};
/** Marta, del wireframe, con un tabulador (el separador del archivo) en su procedencia. */
const MARTA_WITH_TAB: GuestPayload = {
  firstName: 'Marta',
  lastName: 'Kowalski',
  documentType: 'PAS',
  documentNumber: 'PL7730215',
  birthDate: '1986-02-14',
  nationality: 'Polonia',
  originPlace: 'Varsovia,\tPolonia',
  destinationPlace: 'Cartagena, Colombia',
};

const HOTEL = 'DEV-HOTEL\tDEV-CIUDAD';
const LUKAS_ENTRY = `${HOTEL}\tPAS\tC4X8R21K\tAlemania\tBECKER\tLUKAS\tE\t05/03/2027\tBerlín, Alemania\tMedellín, Colombia\t02/07/1991`;
const LUKAS_DEPARTURE = `${HOTEL}\tPAS\tC4X8R21K\tAlemania\tBECKER\tLUKAS\tS\t08/03/2027\tBerlín, Alemania\tMedellín, Colombia\t02/07/1991`;

const MARCH = ['2027-03-01', '2027-03-31'] as const;

describe('Exportar archivo SIRE: casos borde (T013)', () => {
  let sire: Awaited<ReturnType<typeof startSireApp>>;
  let selection: SelectForeignMovements;

  const newUser = () => `recepcion-${randomUUID()}`;

  beforeAll(async () => {
    sire = await startSireApp();
    selection = sire.app.get<SelectForeignMovements>(SELECT_FOREIGN_MOVEMENTS);
    // Marzo de 2027: Lukas entra y sale (dos líneas).
    await sire.stay({
      guests: [LUKAS],
      entry: '2027-03-05',
      exit: '2027-03-08',
      endDate: '2027-03-08',
    });
    // Abril de 2027: Marta tiene el separador del archivo en un dato.
    await sire.stay({
      guests: [MARTA_WITH_TAB],
      entry: '2027-04-05',
      exit: null,
      endDate: '2027-04-08',
    });
    // Mayo de 2027: reservas CANCELLED y NO_SHOW con titulares extranjeros, sin Check-In.
    const reservations = sire.app.get<ReservationRepository>(
      RESERVATION_REPOSITORY,
    );
    for (const [status, statusReason, stayStatus] of [
      ['CANCELLED', 'CANCELLED_BY_RECEPTION', 'EXPECTED'],
      ['NO_SHOW', 'DAY_CLOSE_NO_SHOW', 'NOT_ARRIVED'],
    ] as const) {
      await reservations.insert(
        aDirectReservation({
          startDate: '2027-05-10',
          endDate: '2027-05-12',
          status,
          statusReason,
          rooms: [aDirectRoom({ stayStatus })],
          guest: aGuest({
            firstName: 'John',
            lastName: 'Miller',
            documentType: 'PAS',
            documentNumber: `US-${status}`,
            nationality: 'Estados Unidos',
          }),
        }),
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sire?.app.close();
  });

  it('más de un año: 400 PERIOD_TOO_LARGE con el mensaje literal, sin consultar ni registrar', async () => {
    const user = newUser();
    const byPeriod = vi.spyOn(selection, 'byPeriod');

    const res = await sire
      .exportPeriod(user, '2026-01-01', '2027-01-02')
      .expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'PERIOD_TOO_LARGE',
      message: MESSAGES.PERIOD_TOO_LARGE,
    });
    expect(byPeriod).not.toHaveBeenCalled();
    expect(await sire.exportsOf(user)).toEqual([]);
  });

  it.each([
    ['invertido', '2027-03-31', '2027-03-01', 'INVALID_DATE_RANGE'],
    ['mal formado', '01/03/2027', '2027-03-31', 'INVALID_DATE'],
    ['con una fecha que no existe', '2027-02-30', '2027-03-31', 'INVALID_DATE'],
  ])(
    'periodo %s: 400 %s sin ejecutar ninguna consulta ni registrar',
    async (_case, startDate, endDate, errorCode) => {
      const user = newUser();
      const byPeriod = vi.spyOn(selection, 'byPeriod');

      const res = await sire.exportPeriod(user, startDate, endDate).expect(400);

      expect(res.body).toMatchObject({ errorCode });
      expect(byPeriod).not.toHaveBeenCalled();
      expect(await sire.exportsOf(user)).toEqual([]);
    },
  );

  it('caracteres corruptos (el separador dentro de un dato): 400 INVALID_GUEST_CHARACTERS con el mensaje literal y sin registro', async () => {
    const user = newUser();

    const res = await sire
      .exportPeriod(user, '2027-04-01', '2027-04-30')
      .expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'INVALID_GUEST_CHARACTERS',
      message: MESSAGES.INVALID_GUEST_CHARACTERS,
    });
    expect(await sire.exportsOf(user)).toEqual([]);
  });

  it('solicitudes simultáneas: con 3 exportaciones en curso, la cuarta responde 429 con Retry-After; las 3 terminan bien', async () => {
    // Las exportaciones esperan en la selección hasta que llega la cuarta: así hay 3 en curso a la vez.
    const original = selection.byPeriod.bind(selection);
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let allStarted = () => {};
    const threeStarted = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    vi.spyOn(selection, 'byPeriod').mockImplementation(async (...args) => {
      started += 1;
      if (started === 3) {
        allStarted();
      }
      await released;
      return original(...args);
    });
    const users = [newUser(), newUser(), newUser(), newUser()];

    const running = users
      .slice(0, 3)
      .map((user) => sire.exportPeriod(user, ...MARCH).then((res) => res));
    await threeStarted;
    const fourth = await sire.exportPeriod(users[3], ...MARCH);
    release();
    const done = await Promise.all(running);

    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ errorCode: 'TOO_MANY_REQUESTS' });
    expect(fourth.headers['retry-after']).toBe('2');
    expect(done.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await sire.exportsOf(users[3])).toEqual([]);
  });

  it('falla a mitad de la generación (la segunda línea no se puede escribir): no queda SireExport', async () => {
    const user = newUser();
    const [entry, departure] = await selection.byPeriod(...MARCH);
    const broken: SireMovement = {
      ...departure,
      guest: { ...departure.guest, lastName: 'Becker\nKowalski' },
    };
    vi.spyOn(selection, 'byPeriod').mockResolvedValue([entry, broken]);

    const res = await sire.exportPeriod(user, ...MARCH).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'INVALID_GUEST_CHARACTERS' });
    expect(await sire.exportsOf(user)).toEqual([]);
  });

  it('falla inesperada al registrar: 400 REQUEST_NOT_PROCESSED, sin archivo ni SireExport', async () => {
    const user = newUser();
    vi.spyOn(
      sire.app.get<SireExportRepository>(SIRE_EXPORT_REPOSITORY),
      'insert',
    ).mockRejectedValue(new Error('se cayó la conexión'));

    const res = await sire.exportPeriod(user, ...MARCH).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'REQUEST_NOT_PROCESSED' });
    expect(res.headers['export-id']).toBeUndefined();
    expect(await sire.exportsOf(user)).toEqual([]);
  });

  it('CANCELLED y NO_SHOW no aparecen: nunca tuvieron movimientos, así que su periodo no tiene qué reportar', async () => {
    const res = await sire
      .exportPeriod(newUser(), '2027-05-01', '2027-05-31')
      .expect(400);

    expect(res.body).toMatchObject({ errorCode: 'NO_MIGRATORY_MOVEMENTS' });
  });

  it('el mismo huésped con entrada y salida en el periodo: dos líneas, cada una con su fecha', async () => {
    const res = await sire.exportPeriod(newUser(), ...MARCH).expect(200);

    expect(res.text).toBe(`${LUKAS_ENTRY}\r\n${LUKAS_DEPARTURE}\r\n`);
  });
});
