import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GuestPayload } from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { startSireApp } from '../support/sire.js';

/**
 * T012 de `export-sire-file`: los escenarios 1 a 7 de la historia 1 del spec, con las filas de "Pruebas por
 * escenario" del plan. Todo es real: la aplicación completa por HTTP, PostgreSQL y la configuración `SIRE_*`
 * por defecto de pruebas. Los huéspedes llegan como los envía el Módulo 1 (`RegisterGuestMovements`). Cada
 * escenario usa su propio mes, así sus periodos no se cruzan.
 */

/** John, del ejemplo de A del plan: sus dos líneas son las del ejemplo (con el hotel y la ciudad de pruebas). */
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
/** Los demás, de la vista de huéspedes del wireframe. Ana y Daniela son colombianas. */
const HIROSHI: GuestPayload = {
  firstName: 'Hiroshi',
  lastName: 'Tanaka',
  documentType: 'PAS',
  documentNumber: 'JP0098231',
  birthDate: '1984-03-11',
  nationality: 'Japón',
  originPlace: 'Tokio, Japón',
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
const ISABELA: GuestPayload = {
  firstName: 'Isabela',
  lastName: 'Santos Rocha',
  documentType: 'PAS',
  documentNumber: 'BR552104',
  birthDate: '1988-12-19',
  nationality: 'Brasil',
  originPlace: 'São Paulo, Brasil',
  destinationPlace: 'Santa Marta, Colombia',
};
const PEDRO: GuestPayload = {
  firstName: 'Pedro',
  lastName: 'Santos Rocha',
  documentType: 'PAS',
  documentNumber: 'BR552187',
  birthDate: '2014-05-30',
  nationality: 'Brasil',
  originPlace: 'São Paulo, Brasil',
  destinationPlace: 'Santa Marta, Colombia',
};
const DANIELA: GuestPayload = {
  firstName: 'Daniela',
  lastName: 'Cárdenas Ruiz',
  documentType: 'CC',
  documentNumber: '52118904',
  birthDate: '1992-04-17',
  nationality: 'Colombia',
};
const ANA: GuestPayload = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};

/** Las líneas esperadas, escritas a mano con el formato del plan ("Formato de la línea"). */
const HOTEL = 'DEV-HOTEL\tDEV-CIUDAD';
const LINES = {
  hiroshiEntry: `${HOTEL}\tPAS\tJP0098231\tJapón\tTANAKA\tHIROSHI\tE\t01/10/2026\tTokio, Japón\tCartagena, Colombia\t11/03/1984`,
  hiroshiDeparture: `${HOTEL}\tPAS\tJP0098231\tJapón\tTANAKA\tHIROSHI\tS\t03/10/2026\tTokio, Japón\tCartagena, Colombia\t11/03/1984`,
  johnEntry: `${HOTEL}\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990`,
  johnDeparture: `${HOTEL}\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tS\t12/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990`,
  lukasEntry: `${HOTEL}\tPAS\tC4X8R21K\tAlemania\tBECKER\tLUKAS\tE\t05/11/2026\tBerlín, Alemania\tMedellín, Colombia\t02/07/1991`,
  isabelaEntry: `${HOTEL}\tPAS\tBR552104\tBrasil\tSANTOS ROCHA\tISABELA\tE\t14/12/2026\tSão Paulo, Brasil\tSanta Marta, Colombia\t19/12/1988`,
  pedroEntry: `${HOTEL}\tPAS\tBR552187\tBrasil\tSANTOS ROCHA\tPEDRO\tE\t14/12/2026\tSão Paulo, Brasil\tSanta Marta, Colombia\t30/05/2014`,
};

/** El archivo: cada línea con su fin de línea, también la última (CRLF por defecto). */
const file = (...lines: string[]) =>
  lines.map((line) => `${line}\r\n`).join('');

const OCTOBER = ['2026-10-01', '2026-10-31'] as const;

describe('Exportar archivo SIRE: escenarios 1 a 7 de la historia 1 (T012)', () => {
  let sire: Awaited<ReturnType<typeof startSireApp>>;
  let johnStay: Reservation;

  const newUser = () => `recepcion-${randomUUID()}`;

  const exportCount = async (): Promise<number> => {
    const [{ total }]: { total: number }[] = await sire.dataSource.query(
      'SELECT count(*)::int AS total FROM sire_export',
    );
    return total;
  };

  beforeAll(async () => {
    sire = await startSireApp();
    // Octubre (escenarios 1, 4, 6 y 7): dos extranjeros que entraron y salieron.
    await sire.stay({
      guests: [HIROSHI],
      entry: '2026-10-01',
      exit: '2026-10-03',
      endDate: '2026-10-03',
    });
    johnStay = await sire.stay({
      guests: [JOHN],
      entry: '2026-10-09',
      exit: '2026-10-12',
      endDate: '2026-10-12',
    });
    // Noviembre (escenario 2): Lukas entró y sigue en el hotel.
    await sire.stay({
      guests: [LUKAS],
      entry: '2026-11-05',
      exit: null,
      endDate: '2026-11-08',
    });
    // Diciembre (escenario 3): una reserva con dos extranjeros y una colombiana.
    await sire.stay({
      guests: [ISABELA, DANIELA, PEDRO],
      entry: '2026-12-14',
      exit: null,
      endDate: '2026-12-17',
    });
    // Enero de 2027 (escenario 5): solo una colombiana.
    await sire.stay({
      guests: [ANA],
      entry: '2027-01-10',
      exit: '2027-01-12',
      endDate: '2027-01-12',
    });
  });

  afterAll(async () => {
    await sire?.app.close();
  });

  it('escenario 1: dos extranjeros con entrada y salida en el periodo: 4 líneas en orden y una SireExport con recordsCount = 4', async () => {
    const user = newUser();

    const res = await sire.exportPeriod(user, ...OCTOBER).expect(200);

    expect(res.text).toBe(
      file(
        LINES.hiroshiEntry,
        LINES.hiroshiDeparture,
        LINES.johnEntry,
        LINES.johnDeparture,
      ),
    );
    const [saved] = await sire.exportsOf(user);
    expect(res.headers['export-id']).toBe(saved.id);
    expect(saved).toEqual({
      id: saved.id,
      export_kind: 'PERIOD',
      records_count: 4,
      date_range_start: '2026-10-01',
      date_range_end: '2026-10-31',
    });
  });

  it('escenario 2: el huésped que entró y no ha salido aparece solo con su entrada', async () => {
    const res = await sire
      .exportPeriod(newUser(), '2026-11-01', '2026-11-30')
      .expect(200);

    expect(res.text).toBe(file(LINES.lukasEntry));
  });

  it('escenario 3: el grupo mixto trae una línea por cada extranjero, no solo la del titular, y ninguna de la colombiana', async () => {
    const res = await sire
      .exportPeriod(newUser(), '2026-12-01', '2026-12-31')
      .expect(200);

    expect(res.text).toBe(file(LINES.isabelaEntry, LINES.pedroEntry));
    expect(res.text).not.toContain(DANIELA.documentNumber);
  });

  it('escenario 4: el mismo periodo dos veces da el mismo contenido y dos SireExport distintas', async () => {
    const user = newUser();

    const first = await sire.exportPeriod(user, ...OCTOBER).expect(200);
    const second = await sire.exportPeriod(user, ...OCTOBER).expect(200);

    expect(second.text).toBe(first.text);
    const saved = await sire.exportsOf(user);
    expect(saved).toHaveLength(2);
    expect(saved[0].id).not.toBe(saved[1].id);
    expect(saved.map((row) => row.records_count)).toEqual([4, 4]);
    expect([first.headers['export-id'], second.headers['export-id']]).toEqual(
      saved.map((row) => row.id),
    );
  });

  it.each([
    ['solo con una colombiana', '2027-01-01', '2027-01-31'],
    ['sin ocupación', '2027-02-01', '2027-02-28'],
  ])(
    'escenario 5: un periodo %s responde 400 NO_MIGRATORY_MOVEMENTS, sin archivo ni SireExport',
    async (_case, startDate, endDate) => {
      const user = newUser();

      const res = await sire.exportPeriod(user, startDate, endDate).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'NO_MIGRATORY_MOVEMENTS',
        path: '/api/sire/exports',
      });
      expect(res.headers['export-id']).toBeUndefined();
      expect(await sire.exportsOf(user)).toEqual([]);
    },
  );

  it('escenario 6: la vista previa trae los 12 campos y la misma línea del archivo, sin crear una SireExport', async () => {
    const movementId = await sire.movementIdOf(johnStay, 'X99', 'ENTRY');
    const before = await exportCount();

    const res = await request(sire.app.getHttpServer())
      .get(`/api/sire/movements/${movementId}/preview`)
      .expect(200);

    expect(res.body).toMatchObject({
      movementId,
      reservationRef: johnStay.reservationRef,
      line: LINES.johnEntry,
    });
    expect(
      (res.body as { fields: { value: string }[] }).fields.map(
        (field) => field.value,
      ),
    ).toEqual(LINES.johnEntry.split('\t'));
    expect(await exportCount()).toBe(before);
  });

  it('escenario 7: la descarga individual, dos veces, da un .TXT de una línea cada vez y una SireExport de un registro por cada una', async () => {
    const user = newUser();
    const movementId = await sire.movementIdOf(johnStay, 'X99', 'DEPARTURE');
    const single = () =>
      sire.exportAs(user, { exportKind: 'SINGLE_MOVEMENT', movementId });

    const first = await single().expect(200);
    const second = await single().expect(200);

    expect(first.text).toBe(file(LINES.johnDeparture));
    expect(second.text).toBe(file(LINES.johnDeparture));
    const saved = await sire.exportsOf(user);
    expect(saved).toHaveLength(2);
    for (const row of saved) {
      expect(row).toMatchObject({
        export_kind: 'SINGLE_MOVEMENT',
        records_count: 1,
        date_range_start: null,
        date_range_end: null,
      });
    }
    expect(first.headers['content-disposition']).toBe(
      `attachment; filename="SIRE_${saved[0].id}.txt"`,
    );
  });
});
