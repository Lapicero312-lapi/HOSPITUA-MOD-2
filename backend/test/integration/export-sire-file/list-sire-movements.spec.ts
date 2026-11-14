import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GuestPayload } from '../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SelectForeignMovements,
} from '../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { startSireApp } from '../support/sire.js';

/**
 * T010 de `export-sire-file`: `GET /api/sire/movements` (contrato B y D3). Todo es real: la aplicación
 * completa por HTTP, PostgreSQL y la configuración `SIRE_*` por defecto de pruebas. Los huéspedes llegan
 * como los envía el Módulo 1 (`RegisterGuestMovements`). Cada prueba usa su propio periodo.
 */

/** John, del ejemplo de B del plan; Lukas, de la vista de huéspedes del wireframe; Ana es colombiana. */
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
const ANA: GuestPayload = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};

const NO_MOVEMENTS =
  'No hay movimientos migratorios que reportar en ese periodo.';

/** Mayo de 2027: 13 estadías de dos extranjeros con entrada y salida, 52 movimientos (dos páginas). */
const MAY_2027 = ['2027-05-01', '2027-05-31'] as const;
const MAY_STAYS = 13;

type Item = {
  movementId: string;
  reservationRef: string;
  guest: {
    fullName: string;
    documentType: string;
    documentNumber: string;
    nationality: string;
  };
  movementType: 'ENTRY' | 'DEPARTURE';
  movementDate: string;
};

describe('Listar los movimientos SIRE del periodo: GET /api/sire/movements (T010)', () => {
  let sire: Awaited<ReturnType<typeof startSireApp>>;
  let johnStay: Reservation;
  let lukasStay: Reservation;

  const list = (query: Record<string, string>) =>
    request(sire.app.getHttpServer()).get('/api/sire/movements').query(query);

  const exportCount = async (): Promise<number> => {
    const [{ total }]: { total: number }[] = await sire.dataSource.query(
      'SELECT count(*)::int AS total FROM sire_export',
    );
    return total;
  };

  beforeAll(async () => {
    sire = await startSireApp();
    // Octubre de 2026: Lukas, y John con Ana, colombiana, en la misma reserva.
    lukasStay = await sire.stay({
      guests: [LUKAS],
      entry: '2026-10-01',
      exit: '2026-10-04',
      endDate: '2026-10-04',
    });
    johnStay = await sire.stay({
      guests: [JOHN, ANA],
      entry: '2026-10-09',
      exit: '2026-10-12',
      endDate: '2026-10-12',
    });
    for (let stay = 0; stay < MAY_STAYS; stay++) {
      const day = String(stay + 1).padStart(2, '0');
      await sire.stay({
        guests: [0, 1].map((guest) => ({
          ...LUKAS,
          firstName: `Huésped ${stay}-${guest}`,
          documentNumber: `MAY${stay}G${guest}`,
        })),
        entry: `2027-05-${day}`,
        exit: `2027-05-${String(stay + 15).padStart(2, '0')}`,
        endDate: `2027-05-${String(stay + 15).padStart(2, '0')}`,
      });
    }
  }, 60_000);

  afterAll(async () => {
    await sire?.app.close();
  });

  it('responde 200 con la forma de B: un elemento por huésped extranjero y tipo de movimiento, en el orden del archivo, sin la colombiana', async () => {
    const res = await list({ startDate: '2026-10-01', endDate: '2026-10-31' })
      .expect(200)
      .expect('Content-Type', /application\/json/);

    const movementId = (
      reservation: Reservation,
      documentNumber: string,
      type: 'ENTRY' | 'DEPARTURE',
    ) => sire.movementIdOf(reservation, documentNumber, type);
    const john = {
      fullName: 'John Smith',
      documentType: 'PAS',
      documentNumber: 'X99',
      nationality: 'Estados Unidos',
    };
    const lukas = {
      fullName: 'Lukas Becker',
      documentType: 'PAS',
      documentNumber: 'C4X8R21K',
      nationality: 'Alemania',
    };
    expect(res.body).toEqual({
      items: [
        {
          movementId: await movementId(lukasStay, 'C4X8R21K', 'ENTRY'),
          reservationRef: lukasStay.reservationRef,
          guest: lukas,
          movementType: 'ENTRY',
          movementDate: '2026-10-01',
        },
        {
          movementId: await movementId(lukasStay, 'C4X8R21K', 'DEPARTURE'),
          reservationRef: lukasStay.reservationRef,
          guest: lukas,
          movementType: 'DEPARTURE',
          movementDate: '2026-10-04',
        },
        {
          movementId: await movementId(johnStay, 'X99', 'ENTRY'),
          reservationRef: johnStay.reservationRef,
          guest: john,
          movementType: 'ENTRY',
          movementDate: '2026-10-09',
        },
        {
          movementId: await movementId(johnStay, 'X99', 'DEPARTURE'),
          reservationRef: johnStay.reservationRef,
          guest: john,
          movementType: 'DEPARTURE',
          movementDate: '2026-10-12',
        },
      ],
      page: 1,
      pageSize: 50,
      totalItems: 4,
      totalPages: 1,
      message: null,
    });
  });

  it('solo los movimientos con fecha dentro del periodo, contando el primer y el último día', async () => {
    const res = await list({
      startDate: '2026-10-04',
      endDate: '2026-10-09',
    }).expect(200);

    expect(
      (res.body.items as Item[]).map((item) => [
        item.guest.documentNumber,
        item.movementType,
        item.movementDate,
      ]),
    ).toEqual([
      ['C4X8R21K', 'DEPARTURE', '2026-10-04'],
      ['X99', 'ENTRY', '2026-10-09'],
    ]);
  });

  it('pagina de 50 en 50, y las dos páginas juntas son las líneas del archivo del mismo periodo, en el mismo orden', async () => {
    const [startDate, endDate] = MAY_2027;
    const first = await list({ startDate, endDate }).expect(200);
    const second = await list({ startDate, endDate, page: '2' }).expect(200);
    const file = await sire
      .exportPeriod('recepcion-listado', startDate, endDate)
      .expect(200);

    expect(first.body).toMatchObject({
      page: 1,
      pageSize: 50,
      totalItems: 52,
      totalPages: 2,
      message: null,
    });
    expect(first.body.items).toHaveLength(50);
    expect(second.body).toMatchObject({
      page: 2,
      pageSize: 50,
      totalItems: 52,
      totalPages: 2,
      message: null,
    });
    expect(second.body.items).toHaveLength(2);
    // Campo 4: el documento; campo 8: E o S.
    const fromFile = file.text
      .split('\r\n')
      .filter((line) => line !== '')
      .map((line) => {
        const fields = line.split('\t');
        return [fields[3], fields[7]];
      });
    const listed = [
      ...(first.body.items as Item[]),
      ...(second.body.items as Item[]),
    ].map((item) => [
      item.guest.documentNumber,
      item.movementType === 'ENTRY' ? 'E' : 'S',
    ]);
    expect(listed).toEqual(fromFile);
  });

  it('una página que no existe se ajusta a la última válida', async () => {
    const [startDate, endDate] = MAY_2027;

    const res = await list({ startDate, endDate, page: '7' }).expect(200);

    expect(res.body).toMatchObject({ page: 2, totalPages: 2, totalItems: 52 });
    expect(res.body.items).toHaveLength(2);
  });

  it('un periodo sin extranjeros responde 200 con la lista vacía y el mensaje (no es un error, punto 3)', async () => {
    // Noviembre de 2026 no tiene ningún movimiento.
    const res = await list({
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    }).expect(200);

    expect(res.body).toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 0,
      message: NO_MOVEMENTS,
    });
  });

  it('no registra nada, no pide X-User y no pasa por el límite de solicitudes de la exportación', async () => {
    const before = await exportCount();

    for (let attempt = 0; attempt < 11; attempt++) {
      await list({ startDate: '2026-10-01', endDate: '2026-10-31' }).expect(
        200,
      );
    }

    await expect(exportCount()).resolves.toBe(before);
  });

  describe('los parámetros inválidos responden 400 sin ejecutar ninguna consulta', () => {
    it.each([
      [
        'sin fechas',
        {},
        'INCOMPLETE_DATE_RANGE',
        'Debe completar ambas fechas del rango.',
      ],
      [
        'sin endDate',
        { startDate: '2026-10-01' },
        'INCOMPLETE_DATE_RANGE',
        'Debe completar ambas fechas del rango.',
      ],
      [
        'una fecha que no existe',
        { startDate: '2026-02-30', endDate: '2026-03-31' },
        'INVALID_DATE',
        'La fecha indicada no es válida.',
      ],
      [
        'un periodo invertido',
        { startDate: '2026-10-31', endDate: '2026-10-01' },
        'INVALID_DATE_RANGE',
        'La fecha inicial no puede ser posterior a la fecha final.',
      ],
      [
        'un periodo de más de un año',
        { startDate: '2026-01-01', endDate: '2027-01-02' },
        'PERIOD_TOO_LARGE',
        'El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos.',
      ],
      [
        'la página 0',
        { startDate: '2026-10-01', endDate: '2026-10-31', page: '0' },
        'INVALID_PAGE',
        'El número de página debe ser 1 o mayor.',
      ],
      [
        'una página que no es un entero',
        { startDate: '2026-10-01', endDate: '2026-10-31', page: '1.5' },
        'INVALID_PAGE',
        'El número de página debe ser 1 o mayor.',
      ],
    ])('%s: %s', async (_case, query, errorCode, message) => {
      const byPeriod = vi.spyOn(
        sire.app.get<SelectForeignMovements>(SELECT_FOREIGN_MOVEMENTS),
        'byPeriod',
      );
      try {
        const res = await list(query).expect(400);

        expect(res.body).toMatchObject({
          errorCode,
          message,
          path: '/api/sire/movements',
        });
        expect(byPeriod).not.toHaveBeenCalled();
      } finally {
        byPeriod.mockRestore();
      }
    });

    it('una fecha repetida (llega como lista) es INVALID_DATE', async () => {
      const res = await request(sire.app.getHttpServer())
        .get(
          '/api/sire/movements?startDate=2026-10-01&startDate=2026-10-02&endDate=2026-10-31',
        )
        .expect(400);

      expect(res.body.errorCode).toBe('INVALID_DATE');
    });
  });
});
