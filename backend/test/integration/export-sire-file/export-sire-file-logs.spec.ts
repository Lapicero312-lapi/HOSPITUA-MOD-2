import { randomUUID } from 'node:crypto';
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
  SIRE_EXPORT_REPOSITORY,
  type SireExportRepository,
} from '../../../src/application/ports/out/sire-export.repository.js';
import type { GuestPayload } from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { startSireApp } from '../support/sire.js';

/**
 * T017 de `export-sire-file`: ningún log escribe datos personales de los huéspedes (NFR-002; plan,
 * "Privacidad": "el archivo y los logs no se mezclan: nunca se escriben datos personales en los logs"). La
 * aplicación completa, con PostgreSQL real y sus logs como en producción, en el nivel más bajo y dirigidos a
 * la prueba; también se recoge lo que se escriba con `console`. Se recorre cada ruta de SIRE, las que
 * terminan bien y las que fallan, y se revisa todo lo que se escribió.
 */

/** John, del ejemplo de A del plan; Lukas y Marta, de la vista de huéspedes del wireframe. */
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
/** Marta tiene un tabulador (el separador del archivo) en su procedencia: su exportación falla. */
const MARTA: GuestPayload = {
  firstName: 'Marta',
  lastName: 'Kowalski',
  documentType: 'PAS',
  documentNumber: 'PL7730215',
  birthDate: '1986-02-14',
  nationality: 'Polonia',
  originPlace: 'Varsovia,\tPolonia',
  destinationPlace: 'Gdansk, Polonia',
};

/**
 * Lo que no puede salir en un log: de cada huésped, su documento, sus nombres y apellidos, su fecha de
 * nacimiento, su nacionalidad y sus lugares de procedencia y destino, como están guardados y como van en el
 * archivo (los nombres en mayúsculas y la fecha como `dd/MM/yyyy`).
 */
const PERSONAL_DATA = [JOHN, LUKAS, MARTA].flatMap((guest) => {
  const [year, month, day] = (guest.birthDate as string).split('-');
  return [
    guest.documentNumber,
    guest.firstName,
    guest.lastName,
    guest.firstName?.toUpperCase(),
    guest.lastName?.toUpperCase(),
    guest.birthDate,
    `${day}/${month}/${year}`,
    guest.nationality,
    ...(guest.originPlace ?? '').split('\t'),
    guest.destinationPlace,
  ].filter((value): value is string => value !== undefined && value !== '');
});

/** Una línea del log de pino (JSON); las de cada petición traen `req`, `route` y `res`. */
type LogLine = {
  level: number;
  msg: string;
  req?: { method: string; client: string | null };
  route?: string | null;
  res?: { statusCode: number; errorCode?: string };
};

const EXPORTS_ROUTE = '/api/sire/exports';
const MOVEMENTS_ROUTE = '/api/sire/movements';
const PREVIEW_ROUTE = '/api/sire/movements/:movementId/preview';

describe('Exportar archivo SIRE: logs sin datos personales de los huéspedes (NFR-002, T017)', () => {
  let sire: Awaited<ReturnType<typeof startSireApp>>;
  let johnStay: Reservation;
  /** Lo que escribe pino, tal como sale (una o más líneas JSON por escritura). */
  let written: string[] = [];
  /** Lo que se escribe con `console`. */
  let consoleLines: string[] = [];

  const newUser = () => `recepcion-${randomUUID()}`;
  const pinoLines = (): string[] =>
    written.flatMap((chunk) => chunk.split('\n')).filter((line) => line !== '');
  /** Todo lo que se escribió en el log durante la prueba. */
  const allLogs = (): string => [...pinoLines(), ...consoleLines].join('\n');
  const requestLogs = (): LogLine[] =>
    pinoLines()
      .map((line) => JSON.parse(line) as LogLine)
      .filter((line) => line.req !== undefined);

  /**
   * Espera el log de la petición (se escribe al terminar la respuesta) y revisa que trae el patrón de la
   * ruta, el estado y el código de error, y que en todo lo escrito no hay ningún dato personal.
   */
  async function expectCleanLogs(
    method: 'GET' | 'POST',
    route: string,
    statusCode: number,
    errorCode?: string,
  ): Promise<void> {
    await vi.waitFor(() => expect(requestLogs()).toHaveLength(1), {
      timeout: 5_000,
      interval: 10,
    });
    expect(requestLogs()[0]).toMatchObject({
      req: { method },
      route,
      res: errorCode === undefined ? { statusCode } : { statusCode, errorCode },
    });
    const logs = allLogs();
    for (const value of PERSONAL_DATA) {
      expect(logs).not.toContain(value);
    }
  }

  beforeAll(async () => {
    sire = await startSireApp((chunk) => written.push(chunk));
    // Octubre de 2026: John y Lukas, con entrada y salida.
    johnStay = await sire.stay({
      guests: [JOHN, LUKAS],
      entry: '2026-10-09',
      exit: '2026-10-12',
      endDate: '2026-10-12',
    });
    // Noviembre de 2026: Marta, con el separador en un dato.
    await sire.stay({
      guests: [MARTA],
      entry: '2026-11-05',
      exit: null,
      endDate: '2026-11-08',
    });
  });

  beforeEach(() => {
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
    await sire?.app.close();
  });

  it('la exportación del periodo: el archivo lleva los datos, el log no', async () => {
    const res = await sire
      .exportPeriod(newUser(), '2026-10-01', '2026-10-31')
      .expect(200);

    // El archivo sí los trae: así se sabe que se revisa una exportación con datos.
    expect(res.text).toContain('X99');
    expect(res.text).toContain('C4X8R21K');
    await expectCleanLogs('POST', EXPORTS_ROUTE, 200);
  });

  it('la descarga individual', async () => {
    const movementId = await sire.movementIdOf(johnStay, 'X99', 'ENTRY');

    await sire
      .exportAs(newUser(), { exportKind: 'SINGLE_MOVEMENT', movementId })
      .expect(200);

    await expectCleanLogs('POST', EXPORTS_ROUTE, 200);
  });

  it('la vista previa: el log trae el patrón de la ruta, no la ruta', async () => {
    const movementId = await sire.movementIdOf(johnStay, 'C4X8R21K', 'ENTRY');

    const res = await request(sire.app.getHttpServer())
      .get(`/api/sire/movements/${movementId}/preview`)
      .expect(200);

    expect((res.body as { line: string }).line).toContain('C4X8R21K');
    await expectCleanLogs('GET', PREVIEW_ROUTE, 200);
    expect(allLogs()).not.toContain(movementId);
  });

  it('el listado de los movimientos: la respuesta trae los datos del huésped, el log no', async () => {
    const res = await request(sire.app.getHttpServer())
      .get('/api/sire/movements')
      .query({ startDate: '2026-10-01', endDate: '2026-10-31' })
      .expect(200);

    // La respuesta sí los trae: así se sabe que se revisa un listado con datos.
    const body = JSON.stringify(res.body);
    expect(body).toContain('X99');
    expect(body).toContain('Lukas Becker');
    await expectCleanLogs('GET', MOVEMENTS_ROUTE, 200);
  });

  it('un rechazo del listado (INVALID_PAGE)', async () => {
    await request(sire.app.getHttpServer())
      .get('/api/sire/movements')
      .query({ startDate: '2026-10-01', endDate: '2026-10-31', page: '0' })
      .expect(400);

    await expectCleanLogs('GET', MOVEMENTS_ROUTE, 400, 'INVALID_PAGE');
  });

  it('un dato del huésped que no se puede escribir (INVALID_GUEST_CHARACTERS): el log no dice cuál ni de quién', async () => {
    await sire.exportPeriod(newUser(), '2026-11-01', '2026-11-30').expect(400);

    await expectCleanLogs(
      'POST',
      EXPORTS_ROUTE,
      400,
      'INVALID_GUEST_CHARACTERS',
    );
  });

  it.each([
    [
      'un periodo sin extranjeros',
      { exportKind: 'PERIOD', startDate: '2027-02-01', endDate: '2027-02-28' },
      'NO_MIGRATORY_MOVEMENTS',
    ],
    [
      'un periodo invertido',
      { exportKind: 'PERIOD', startDate: '2026-10-31', endDate: '2026-10-01' },
      'INVALID_DATE_RANGE',
    ],
    [
      'un movimiento que no existe',
      { exportKind: 'SINGLE_MOVEMENT', movementId: randomUUID() },
      'MOVEMENT_NOT_FOUND',
    ],
  ])('un rechazo de la exportación (%s)', async (_case, body, errorCode) => {
    await sire.exportAs(newUser(), body).expect(400);

    await expectCleanLogs('POST', EXPORTS_ROUTE, 400, errorCode);
  });

  it('una falla inesperada después de generar el archivo (REQUEST_NOT_PROCESSED): el error queda en el log sin el contenido del archivo', async () => {
    vi.spyOn(
      sire.app.get<SireExportRepository>(SIRE_EXPORT_REPOSITORY),
      'insert',
    ).mockRejectedValue(new Error('se cayó la conexión'));

    await sire.exportPeriod(newUser(), '2026-10-01', '2026-10-31').expect(400);

    await expectCleanLogs('POST', EXPORTS_ROUTE, 400, 'REQUEST_NOT_PROCESSED');
    // La falla sí quedó escrita: la prueba no pasa por no haber nada que revisar.
    expect(allLogs()).toContain('se cayó la conexión');
  });

  it('el límite de solicitudes (429)', async () => {
    const user = newUser();
    // Las 10 admitidas cuentan aunque la exportación las rechace (plan, punto 13).
    for (let attempt = 0; attempt < 10; attempt++) {
      await sire.exportAs(user, { exportKind: 'MONTHLY' }).expect(400);
    }
    written = [];

    await sire.exportPeriod(user, '2026-10-01', '2026-10-31').expect(429);

    await expectCleanLogs('POST', EXPORTS_ROUTE, 429, 'TOO_MANY_REQUESTS');
  });
});
