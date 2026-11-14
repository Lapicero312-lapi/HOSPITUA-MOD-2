import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GuestStayCriteria } from '../../../src/application/ports/out/guest-stay.query.js';
import { GuestData } from '../../../src/domain/migration/guest-data.js';
import { MigratoryMovement } from '../../../src/domain/migration/migratory-movement.js';
import type { DocumentType } from '../../../src/domain/shared/enums.js';
import { TypeOrmGuestDataRepository } from '../../../src/infrastructure/out/persistence/repositories/guest-data.repository.js';
import { TypeOrmGuestStayQuery } from '../../../src/infrastructure/out/persistence/repositories/guest-stay.query.js';
import { TypeOrmMigratoryMovementRepository } from '../../../src/infrastructure/out/persistence/repositories/migratory-movement.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { aDirectReservation } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** Un huésped en una reserva, con su entrada y su salida si las tiene. */
type StaySeed = {
  reservationRef?: string;
  firstName?: string;
  lastName?: string;
  documentType?: DocumentType;
  documentNumber: string;
  nationality?: string;
  entry?: string;
  exit?: string;
};

/** Sin filtros, con el día operativo 2026-10-15. */
const ALL: GuestStayCriteria = {
  nationality: 'ALL',
  presence: 'ALL',
  dateRange: null,
  search: null,
  today: '2026-10-15',
};

describe('TypeOrmGuestStayQuery contra PostgreSQL real (plan de process-guest-data, C1)', () => {
  let dataSource: DataSource;
  let query: TypeOrmGuestStayQuery;
  let transactions: TypeOrmTransactionRunner;
  let reservations: TypeOrmReservationRepository;

  /** Crea la reserva si hace falta, el `GuestData` y sus movimientos. Devuelve la referencia de la reserva. */
  async function seed(stay: StaySeed): Promise<string> {
    const reservationRef =
      stay.reservationRef ??
      (await reservations.insert(aDirectReservation())).reservationRef;
    const guest = GuestData.restore({
      id: randomUUID(),
      reservationRef,
      firstName: stay.firstName ?? 'Huésped',
      lastName: stay.lastName ?? stay.documentNumber,
      documentType: stay.documentType ?? 'PAS',
      documentNumber: stay.documentNumber,
      birthDate: '1990-05-12',
      nationality: stay.nationality ?? 'Estados Unidos',
      originPlace: null,
      destinationPlace: null,
    });
    const movement = (
      movementType: 'ENTRY' | 'DEPARTURE',
      movementDate: string,
    ) =>
      MigratoryMovement.restore({
        id: randomUUID(),
        guestDataId: guest.id,
        movementType,
        movementDate,
      });
    await transactions.run(async (tx) => {
      await new TypeOrmGuestDataRepository(dataSource).insertMissing(
        [guest],
        tx,
      );
      await new TypeOrmMigratoryMovementRepository(dataSource).insertMissing(
        [
          ...(stay.entry === undefined ? [] : [movement('ENTRY', stay.entry)]),
          ...(stay.exit === undefined
            ? []
            : [movement('DEPARTURE', stay.exit)]),
        ],
        tx,
      );
    });
    return reservationRef;
  }

  /** Los documentos de la primera página (hasta 50), en orden. */
  const documentsOf = async (criteria: GuestStayCriteria) =>
    (await query.findPage(criteria, 0, 50)).map((row) => row.documentNumber);

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    query = new TypeOrmGuestStayQuery(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
    reservations = new TypeOrmReservationRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('una fila por huésped y reserva, con su entrada, su salida y sus datos', async () => {
    const ref = await seed({
      firstName: 'John',
      lastName: 'Smith',
      documentNumber: 'X99',
      entry: '2026-10-09',
    });

    await expect(query.findPage(ALL, 0, 10)).resolves.toEqual([
      {
        reservationRef: ref,
        firstName: 'John',
        lastName: 'Smith',
        documentType: 'PAS',
        documentNumber: 'X99',
        nationality: 'Estados Unidos',
        entryDate: '2026-10-09',
        exitDate: null,
      },
    ]);
    await expect(query.count(ALL)).resolves.toBe(1);
  });

  it('el mismo huésped en dos reservas aparece dos veces, cada una con su entrada y su salida', async () => {
    const first = await seed({
      firstName: 'John',
      lastName: 'Smith',
      documentNumber: 'X99',
      entry: '2026-09-01',
      exit: '2026-09-03',
    });
    const second = await seed({
      firstName: 'John',
      lastName: 'Smith',
      documentNumber: 'X99',
      entry: '2026-10-09',
    });
    const john = {
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: 'X99',
      nationality: 'Estados Unidos',
    };

    // La estadía que ya terminó trae su salida de la base; la actual, ninguna.
    await expect(query.findPage(ALL, 0, 10)).resolves.toEqual([
      {
        reservationRef: second,
        ...john,
        entryDate: '2026-10-09',
        exitDate: null,
      },
      {
        reservationRef: first,
        ...john,
        entryDate: '2026-09-01',
        exitDate: '2026-09-03',
      },
    ]);
  });

  it('FR-016: un huésped sin movimientos no aparece ni cuenta', async () => {
    await seed({ documentNumber: 'SIN-MOV' });
    await seed({ documentNumber: 'X99', entry: '2026-10-09' });

    await expect(documentsOf(ALL)).resolves.toEqual(['X99']);
    await expect(query.count(ALL)).resolves.toBe(1);
  });

  it('ordena por entrada de la más reciente a la más antigua; sin entrada, por su salida (punto 7)', async () => {
    await seed({
      documentNumber: 'E-1005',
      entry: '2026-10-05',
      exit: '2026-10-07',
    });
    await seed({ documentNumber: 'E-1009', entry: '2026-10-09' });
    await seed({ documentNumber: 'S-1007', exit: '2026-10-07' });
    await seed({ documentNumber: 'E-1001', entry: '2026-10-01' });

    await expect(documentsOf(ALL)).resolves.toEqual([
      'E-1009',
      'S-1007',
      'E-1005',
      'E-1001',
    ]);
  });

  it('con la misma fecha, ordena por reserva y luego por documento', async () => {
    const refA = await seed({ documentNumber: 'B2', entry: '2026-10-09' });
    await seed({
      reservationRef: refA,
      documentNumber: 'A1',
      entry: '2026-10-09',
    });
    const refB = await seed({ documentNumber: 'C3', entry: '2026-10-09' });
    const inA = [
      [refA, 'A1'],
      [refA, 'B2'],
    ];
    const expected =
      refA < refB ? [...inA, [refB, 'C3']] : [[refB, 'C3'], ...inA];

    const rows = await query.findPage(ALL, 0, 10);

    expect(rows.map((row) => [row.reservationRef, row.documentNumber])).toEqual(
      expected,
    );
  });

  describe('nacionalidad (escenario 2 y punto 8)', () => {
    beforeEach(async () => {
      await seed({
        documentNumber: 'CO',
        nationality: 'Colombia',
        entry: '2026-10-09',
      });
      await seed({
        documentNumber: 'US',
        nationality: 'Estados Unidos',
        entry: '2026-10-08',
      });
      await seed({
        documentNumber: 'MAY',
        nationality: 'COLOMBIA',
        entry: '2026-10-07',
      });
      await seed({
        documentNumber: 'VACIA',
        nationality: '',
        entry: '2026-10-06',
      });
    });

    it('FOREIGN: distinta de Colombia y no vacía, con comparación exacta', async () => {
      await expect(
        documentsOf({ ...ALL, nationality: 'FOREIGN' }),
      ).resolves.toEqual(['US', 'MAY']);
    });

    it('COLOMBIAN: exactamente Colombia', async () => {
      await expect(
        documentsOf({ ...ALL, nationality: 'COLOMBIAN' }),
      ).resolves.toEqual(['CO']);
    });

    it('ALL: todos, también la vacía', async () => {
      await expect(query.count(ALL)).resolves.toBe(4);
    });
  });

  describe('situación (escenario 3)', () => {
    beforeEach(async () => {
      await seed({ documentNumber: 'EN-HOTEL', entry: '2026-10-09' });
      await seed({
        documentNumber: 'SALIO',
        entry: '2026-10-05',
        exit: '2026-10-07',
      });
      await seed({ documentNumber: 'SOLO-SALIDA', exit: '2026-10-04' });
    });

    it('IN_HOTEL: con entrada y sin salida', async () => {
      await expect(
        documentsOf({ ...ALL, presence: 'IN_HOTEL' }),
      ).resolves.toEqual(['EN-HOTEL']);
    });

    it('CHECKED_OUT: con salida, aunque no tenga entrada', async () => {
      await expect(
        documentsOf({ ...ALL, presence: 'CHECKED_OUT' }),
      ).resolves.toEqual(['SALIO', 'SOLO-SALIDA']);
    });
  });

  describe('periodo: la estadía se cruza con el rango (escenario 4 y punto 5)', () => {
    beforeEach(async () => {
      // Del 5 al 7 de octubre; abierta desde el 10 (hoy es el 15); solo con salida el 12.
      await seed({
        documentNumber: 'CERRADA',
        entry: '2026-10-05',
        exit: '2026-10-07',
      });
      await seed({ documentNumber: 'ABIERTA', entry: '2026-10-10' });
      await seed({ documentNumber: 'SOLO-SALIDA', exit: '2026-10-12' });
    });

    const inRange = (dateFrom: string, dateTo: string) =>
      documentsOf({ ...ALL, dateRange: { dateFrom, dateTo } });

    it.each([
      [
        'un rango dentro de la estadía',
        '2026-10-06',
        '2026-10-06',
        ['CERRADA'],
      ],
      [
        'el rango termina el día de la entrada',
        '2026-10-01',
        '2026-10-05',
        ['CERRADA'],
      ],
      [
        'el rango empieza el día de la salida',
        '2026-10-07',
        '2026-10-08',
        ['CERRADA'],
      ],
      [
        'el rango empieza al día siguiente de la salida',
        '2026-10-08',
        '2026-10-09',
        [],
      ],
      ['la abierta sigue hasta hoy', '2026-10-14', '2026-10-15', ['ABIERTA']],
      [
        'después de hoy la abierta ya no cuenta',
        '2026-10-16',
        '2026-10-20',
        [],
      ],
      [
        'la que solo tiene salida, ese día',
        '2026-10-12',
        '2026-10-12',
        ['SOLO-SALIDA', 'ABIERTA'],
      ],
      [
        'un rango que las cubre todas',
        '2026-10-01',
        '2026-10-31',
        ['SOLO-SALIDA', 'ABIERTA', 'CERRADA'],
      ],
    ])('%s', async (_caso, dateFrom, dateTo, expected) => {
      await expect(inRange(dateFrom, dateTo)).resolves.toEqual(expected);
    });
  });

  describe('búsqueda (escenario 5)', () => {
    beforeEach(async () => {
      await seed({
        documentNumber: 'X99',
        firstName: 'John',
        lastName: 'Smith',
        entry: '2026-10-09',
      });
      await seed({
        documentNumber: 'CC-123',
        firstName: 'María José',
        lastName: 'Núñez',
        entry: '2026-10-08',
      });
    });

    it('por documento, coincidencia exacta', async () => {
      await expect(
        documentsOf({
          ...ALL,
          search: { kind: 'DOCUMENT', documentNumber: 'X99' },
        }),
      ).resolves.toEqual(['X99']);
      await expect(
        documentsOf({
          ...ALL,
          search: { kind: 'DOCUMENT', documentNumber: 'X9' },
        }),
      ).resolves.toEqual([]);
      await expect(
        documentsOf({
          ...ALL,
          search: { kind: 'DOCUMENT', documentNumber: 'x99' },
        }),
      ).resolves.toEqual([]);
    });

    it.each([
      ['el apellido sin tildes ni mayúsculas', 'nunez', ['CC-123']],
      ['parte del nombre, con mayúsculas', 'JOS', ['CC-123']],
      ['parte del medio del apellido', 'mit', ['X99']],
      ['con tilde aunque el dato no la tenga', 'smíth', ['X99']],
      ['algo que nadie tiene', 'pedro', []],
    ])('por nombre: %s', async (_caso, text, expected) => {
      await expect(
        documentsOf({ ...ALL, search: { kind: 'NAME', text } }),
      ).resolves.toEqual(expected);
    });
  });

  it('los filtros se combinan con la regla "Y" (FR-013)', async () => {
    await seed({
      documentNumber: 'US-EN',
      nationality: 'Estados Unidos',
      entry: '2026-10-09',
    });
    await seed({
      documentNumber: 'US-SALIO',
      nationality: 'Estados Unidos',
      entry: '2026-10-05',
      exit: '2026-10-07',
    });
    await seed({
      documentNumber: 'CO-EN',
      nationality: 'Colombia',
      entry: '2026-10-09',
    });

    const criteria: GuestStayCriteria = {
      ...ALL,
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
    };

    await expect(documentsOf(criteria)).resolves.toEqual(['US-EN']);
    await expect(query.count(criteria)).resolves.toBe(1);
  });

  it('pagina con el offset y el límite que recibe', async () => {
    for (let day = 1; day <= 12; day++) {
      await seed({
        documentNumber: `D${String(day).padStart(2, '0')}`,
        entry: `2026-10-${String(day).padStart(2, '0')}`,
      });
    }

    const second = await query.findPage(ALL, 10, 10);

    expect(second.map((row) => row.documentNumber)).toEqual(['D02', 'D01']);
    await expect(query.count(ALL)).resolves.toBe(12);
  });

  describe('findDetail (C2)', () => {
    it('trae todos los datos del huésped y sus movimientos por fecha', async () => {
      const ref = await seed({
        firstName: 'John',
        lastName: 'Smith',
        documentNumber: 'X99',
        entry: '2026-10-09',
        exit: '2026-10-12',
      });

      await expect(query.findDetail(ref, 'X99')).resolves.toEqual({
        reservationRef: ref,
        firstName: 'John',
        lastName: 'Smith',
        documentType: 'PAS',
        documentNumber: 'X99',
        birthDate: '1990-05-12',
        nationality: 'Estados Unidos',
        originPlace: null,
        destinationPlace: null,
        movements: [
          { movementType: 'ENTRY', movementDate: '2026-10-09' },
          { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
        ],
      });
    });

    it('el mismo día, la entrada va antes que la salida', async () => {
      const ref = await seed({
        documentNumber: 'X99',
        entry: '2026-10-09',
        exit: '2026-10-09',
      });

      const detail = await query.findDetail(ref, 'X99');

      expect(detail?.movements.map(({ movementType }) => movementType)).toEqual(
        ['ENTRY', 'DEPARTURE'],
      );
    });

    it('solo con la salida trae solo la salida', async () => {
      const ref = await seed({ documentNumber: 'X99', exit: '2026-10-12' });

      const detail = await query.findDetail(ref, 'X99');

      expect(detail?.movements).toEqual([
        { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
      ]);
    });

    it('sin movimientos trae al huésped con la lista vacía', async () => {
      const ref = await seed({ documentNumber: 'SIN-MOV' });

      const detail = await query.findDetail(ref, 'SIN-MOV');

      expect(detail?.movements).toEqual([]);
    });

    it('solo el de esa reserva: el mismo huésped en otra reserva no se mezcla', async () => {
      const september = await seed({
        documentNumber: 'X99',
        entry: '2026-09-01',
        exit: '2026-09-03',
      });
      const october = await seed({
        documentNumber: 'X99',
        entry: '2026-10-09',
      });

      const detail = await query.findDetail(october, 'X99');

      expect(detail?.reservationRef).toBe(october);
      expect(detail?.movements).toEqual([
        { movementType: 'ENTRY', movementDate: '2026-10-09' },
      ]);
      expect(
        (await query.findDetail(september, 'X99'))?.movements,
      ).toHaveLength(2);
    });

    it.each([
      ['otro documento', 'RSV', 'X98'],
      ['el documento en minúsculas (coincidencia exacta)', 'RSV', 'x99'],
      ['otra reserva', 'OTHER', 'X99'],
    ])('con %s no lo encuentra', async (_case, which, documentNumber) => {
      const ref = await seed({ documentNumber: 'X99', entry: '2026-10-09' });

      await expect(
        query.findDetail(
          which === 'RSV' ? ref : 'RSV-00000000',
          documentNumber,
        ),
      ).resolves.toBeNull();
    });
  });
});
