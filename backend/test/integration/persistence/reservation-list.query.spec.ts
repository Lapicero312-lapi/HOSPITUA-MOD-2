import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReservationListFilters } from '../../../src/application/ports/out/reservation-query.port.js';
import type { Ota } from '../../../src/domain/ota/ota.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../src/domain/reservation/reservation.js';
import { RESERVATION_STATUSES } from '../../../src/domain/shared/enums.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import {
  aGuest,
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** Sin filtros y de la más reciente a la más antigua, como abre la pantalla (C1). */
const NO_FILTERS: ReservationListFilters = {
  status: null,
  source: null,
  otaId: null,
  inConflict: false,
  stayRange: null,
  arrivalDate: null,
  order: 'desc',
  search: null,
};

describe('TypeOrmReservationQuery.listReservations contra PostgreSQL real (check-view-reservation, T005)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;
  let otas: TypeOrmOtaRepository;
  let codes: number;

  const direct = (changes: Partial<ReservationProps> = {}) =>
    reservations.insert(aDirectReservation(changes));

  /** Una reserva de la agencia, con un código de confirmación propio. */
  const booking = (ota: Ota, changes: Partial<ReservationProps> = {}) =>
    reservations.insert(
      anOtaReservation(ota.id, {
        ota: otaTerms(ota.id, { externalConfirmationCode: String(++codes) }),
        ...changes,
      }),
    );

  const list = (filters: Partial<ReservationListFilters> = {}, page = 1) =>
    query.listReservations({ ...NO_FILTERS, ...filters }, page);

  const refsOf = (page: { items: { reservation: Reservation }[] }) =>
    page.items.map((item) => item.reservation.reservationRef);

  /** Un huésped de la reserva y, si se pide, su movimiento migratorio (`process-guest-data`). */
  async function aGuestStay(
    reservation: Reservation,
    nationality: string,
    withMovement = true,
  ): Promise<void> {
    const [{ id }]: { id: string }[] = await dataSource.query(
      `INSERT INTO guest_data (reservation_id, document_type, document_number, first_name, last_name,
                               birth_date, nationality)
       VALUES ($1, 'PAS', $2, 'John', 'Smith', '1990-05-12', $3) RETURNING id`,
      [reservation.id, `X${++codes}`, nationality],
    );
    if (withMovement) {
      await dataSource.query(
        `INSERT INTO migratory_movement (guest_data_id, movement_type, movement_date)
         VALUES ($1, 'ENTRY', $2)`,
        [id, reservation.startDate],
      );
    }
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    query = new TypeOrmReservationQuery(dataSource);
    reservations = new TypeOrmReservationRepository(dataSource);
    otas = new TypeOrmOtaRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    codes = 4417829000;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('paginación y orden (FR-001, FR-003a)', () => {
    /** 45 reservas en los seis estados, cada una un día después de la anterior desde el 2026-10-01. */
    async function fortyFive(): Promise<Reservation[]> {
      const saved: Reservation[] = [];
      for (let day = 0; day < 45; day++) {
        const start = new Date(Date.UTC(2026, 9, 1 + day));
        const end = new Date(Date.UTC(2026, 9, 3 + day));
        saved.push(
          await direct({
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            status: RESERVATION_STATUSES[day % RESERVATION_STATUSES.length],
          }),
        );
      }
      return saved;
    }

    it('escenario 1: sin filtros, la página 1 trae 10 de 45, de la llegada más reciente a la más antigua', async () => {
      const saved = await fortyFive();

      const page = await list();

      expect(page.totalItems).toBe(45);
      expect(refsOf(page)).toEqual(
        saved
          .slice(35)
          .reverse()
          .map((reservation) => reservation.reservationRef),
      );
    });

    it('escenario 6: en orden ascendente empieza por la llegada más antigua', async () => {
      const saved = await fortyFive();

      const page = await list({ order: 'asc' });

      expect(refsOf(page)).toEqual(
        saved.slice(0, 10).map((reservation) => reservation.reservationRef),
      );
    });

    it('escenario 7: con 25 reservas, la página 3 trae las 5 últimas', async () => {
      const saved: Reservation[] = [];
      for (let day = 0; day < 25; day++) {
        saved.push(
          await direct({
            startDate: `2026-10-${String(day + 1).padStart(2, '0')}`,
            endDate: `2026-10-${String(day + 3).padStart(2, '0')}`,
          }),
        );
      }

      const page = await list({ order: 'asc' }, 3);

      expect(page.totalItems).toBe(25);
      expect(refsOf(page)).toEqual(
        saved.slice(20).map((reservation) => reservation.reservationRef),
      );
    });

    it('con la misma llegada, desempata por la referencia en el mismo sentido', async () => {
      const refs = ['RSV-0000000A', 'RSV-0000000C', 'RSV-0000000B'];
      for (const reservationRef of refs) {
        await direct({ reservationRef, startDate: '2026-10-09' });
      }

      expect(refsOf(await list({ order: 'asc' }))).toEqual([
        'RSV-0000000A',
        'RSV-0000000B',
        'RSV-0000000C',
      ]);
      expect(refsOf(await list({ order: 'desc' }))).toEqual([
        'RSV-0000000C',
        'RSV-0000000B',
        'RSV-0000000A',
      ]);
    });

    it('una página que pasa de la última viene vacía, con el total real (el ajuste es de T011)', async () => {
      await direct();
      await direct();

      await expect(list({}, 2)).resolves.toEqual({
        totalItems: 2,
        items: [],
      });
    });

    it('escenario 8: sin reservas, ningún ítem y total 0', async () => {
      await expect(list()).resolves.toEqual({ totalItems: 0, items: [] });
    });

    it.each([0, -1, 1.5])(
      'la página %s es un error del programa: la valida T007',
      async (page) => {
        await expect(list({}, page)).rejects.toThrow(
          'no es un entero de 1 en adelante',
        );
      },
    );
  });

  describe('filtros (FR-002, FR-003)', () => {
    it('escenario 2: por estado, solo las PENDING', async () => {
      const ota = await otas.insert(anOta());
      await direct({ status: 'ACTIVE' });
      const pending = await booking(ota, { status: 'PENDING' });
      await direct({ status: 'CANCELLED' });

      const page = await list({ status: 'PENDING' });

      expect(page.totalItems).toBe(1);
      expect(refsOf(page)).toEqual([pending.reservationRef]);
    });

    it('escenario 3: por canal OTA y una agencia, solo las de esa agencia, con su nombre y su código', async () => {
      const bookingCom = await otas.insert(anOta({ name: 'Booking.com' }));
      const expedia = await otas.insert(anOta({ name: 'Expedia' }));
      await direct();
      const fromBooking = await booking(bookingCom);
      await booking(expedia);

      const page = await list({ source: 'OTA', otaId: bookingCom.id });

      expect(page.totalItems).toBe(1);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].otaName).toBe('Booking.com');
      expect(page.items[0].reservation.ota?.externalConfirmationCode).toBe(
        fromBooking.ota?.externalConfirmationCode,
      );
    });

    it('por canal DIRECT, solo las directas, sin agencia', async () => {
      const ota = await otas.insert(anOta());
      const own = await direct();
      await booking(ota);

      const page = await list({ source: 'DIRECT' });

      expect(refsOf(page)).toEqual([own.reservationRef]);
      expect(page.items[0].otaName).toBeNull();
    });

    it('escenario 4: por estadía, las que se cruzan con el rango y no la tercera', async () => {
      const first = await direct({
        startDate: '2026-09-28',
        endDate: '2026-10-03',
      });
      const second = await direct({
        startDate: '2026-10-05',
        endDate: '2026-10-08',
      });
      await direct({ startDate: '2026-10-10', endDate: '2026-10-12' });

      const page = await list({
        stayRange: { dateFrom: '2026-10-02', dateTo: '2026-10-06' },
        order: 'asc',
      });

      expect(refsOf(page)).toEqual([
        first.reservationRef,
        second.reservationRef,
      ]);
    });

    it('el borde del cruce: entra la que llega el último día y no la que sale el primero (la salida no ocupa)', async () => {
      const arrivesOnLastDay = await direct({
        startDate: '2026-10-06',
        endDate: '2026-10-08',
      });
      await direct({ startDate: '2026-09-30', endDate: '2026-10-02' });

      const page = await list({
        stayRange: { dateFrom: '2026-10-02', dateTo: '2026-10-06' },
      });

      expect(refsOf(page)).toEqual([arrivesOnLastDay.reservationRef]);
    });

    it('escenario 5: estado, canal y un solo día combinados', async () => {
      const ota = await otas.insert(anOta());
      const match = await direct({
        status: 'ACTIVE',
        startDate: '2026-09-30',
        endDate: '2026-10-02',
      });
      await direct({
        status: 'CANCELLED',
        startDate: '2026-09-30',
        endDate: '2026-10-02',
      });
      await booking(ota, {
        status: 'ACTIVE',
        startDate: '2026-09-30',
        endDate: '2026-10-02',
      });
      await direct({
        status: 'ACTIVE',
        startDate: '2026-10-05',
        endDate: '2026-10-07',
      });

      const page = await list({
        status: 'ACTIVE',
        source: 'DIRECT',
        stayRange: { dateFrom: '2026-10-01', dateTo: '2026-10-01' },
      });

      expect(page.totalItems).toBe(1);
      expect(refsOf(page)).toEqual([match.reservationRef]);
    });

    it('escenario 1a: por día de llegada (FR-003b), las que llegan ese día en cualquier estado, y no la que ya estaba ni la de mañana', async () => {
      const active = await direct({
        status: 'ACTIVE',
        startDate: '2026-10-09',
        endDate: '2026-10-11',
      });
      const cancelled = await direct({
        status: 'CANCELLED',
        startDate: '2026-10-09',
        endDate: '2026-10-10',
      });
      await direct({
        status: 'IN_PROGRESS',
        startDate: '2026-10-08',
        endDate: '2026-10-12',
      });
      await direct({ startDate: '2026-10-10', endDate: '2026-10-12' });

      const page = await list({ arrivalDate: '2026-10-09' });

      expect(page.totalItems).toBe(2);
      expect(refsOf(page).sort()).toEqual(
        [active.reservationRef, cancelled.reservationRef].sort(),
      );
    });

    it('el día de llegada se combina con los demás filtros (FR-003b)', async () => {
      const active = await direct({
        status: 'ACTIVE',
        startDate: '2026-10-09',
        endDate: '2026-10-11',
      });
      await direct({
        status: 'CANCELLED',
        startDate: '2026-10-09',
        endDate: '2026-10-10',
      });

      const page = await list({ arrivalDate: '2026-10-09', status: 'ACTIVE' });

      expect(refsOf(page)).toEqual([active.reservationRef]);
    });

    it('en conflicto (FR-002a): solo las de Booking con conflicto', async () => {
      const ota = await otas.insert(anOta());
      await direct();
      await booking(ota);
      const inConflict = await booking(ota, {
        rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
        conflict: {
          reason: 'NO_ROOM_AVAILABLE',
          detectedAt: new Date('2026-10-08T14:00:00.000Z'),
        },
      });

      const page = await list({ inConflict: true });

      expect(refsOf(page)).toEqual([inConflict.reservationRef]);
    });
  });

  describe('cada reserva de la página', () => {
    it('una reserva con dos habitaciones aparece una sola vez, con las dos (SC-003)', async () => {
      const twoRooms = await direct({
        rooms: [
          aDirectRoom({ roomNumber: '202' }),
          aDirectRoom({ roomNumber: '201' }),
        ],
      });
      await direct();

      const page = await list();

      expect(page.totalItems).toBe(2);
      expect(page.items).toHaveLength(2);
      const listed = page.items.find(
        (item) => item.reservation.id === twoRooms.id,
      );
      expect(listed?.reservation.rooms.map((room) => room.roomNumber)).toEqual([
        '201',
        '202',
      ]);
    });

    it('trae la reserva completa, con su titular y su updatedAt, igual que el repositorio', async () => {
      const saved = await direct();

      const [item] = (await list()).items;

      expect(item.reservation.snapshot()).toEqual(
        (await reservations.findById(saved.id))?.snapshot(),
      );
    });

    describe('hasForeignMovement (FR-005b)', () => {
      it('con un movimiento de un huésped extranjero es true', async () => {
        const reservation = await direct({ status: 'IN_PROGRESS' });
        await aGuestStay(reservation, 'Estados Unidos');

        const [item] = (await list()).items;

        expect(item.hasForeignMovement).toBe(true);
      });

      it.each([
        ['de un colombiano', 'Colombia', true],
        ['de nacionalidad vacía (no es extranjera)', '', true],
        ['extranjero sin movimiento', 'Estados Unidos', false],
      ])('con un huésped %s es false', async (_, nationality, withMovement) => {
        const reservation = await direct({ status: 'IN_PROGRESS' });
        await aGuestStay(reservation, nationality, withMovement);

        const [item] = (await list()).items;

        expect(item.hasForeignMovement).toBe(false);
      });

      it('el movimiento de otra reserva no cuenta', async () => {
        const withForeigner = await direct({
          startDate: '2026-11-20',
          endDate: '2026-11-22',
        });
        await aGuestStay(withForeigner, 'Estados Unidos');
        const without = await direct({ startDate: '2026-11-10' });

        const page = await list();

        expect(
          page.items.map((item) => [
            item.reservation.id,
            item.hasForeignMovement,
          ]),
        ).toEqual([
          [withForeigner.id, true],
          [without.id, false],
        ]);
      });
    });
  });

  describe('la búsqueda (T015 y T020)', () => {
    it('CODE: la referencia sin distinguir mayúsculas', async () => {
      const wanted = await direct({ reservationRef: 'RSV-3F9A1C7B' });
      await direct({ reservationRef: 'RSV-0A1B2C3D' });

      const page = await list({
        search: { kind: 'CODE', code: 'rsv-3f9a1c7b' },
      });

      expect(refsOf(page)).toEqual([wanted.reservationRef]);
    });

    it('CODE: el código de la OTA, y también una referencia igual a ese código en otra reserva: las dos', async () => {
      const ota = await otas.insert(anOta());
      const byCode = await reservations.insert(
        anOtaReservation(ota.id, {
          ota: otaTerms(ota.id, { externalConfirmationCode: 'ab-77' }),
        }),
      );
      await booking(ota);

      const page = await list({ search: { kind: 'CODE', code: 'AB-77' } });

      expect(refsOf(page)).toEqual([byCode.reservationRef]);
    });

    it('CODE ignora los demás filtros: estado, canal, agencia, conflicto, estadía y día de llegada', async () => {
      const wanted = await direct({ reservationRef: 'RSV-3F9A1C7B' });

      const page = await list({
        status: 'CANCELLED',
        source: 'OTA',
        otaId: randomUUID(),
        inConflict: true,
        stayRange: { dateFrom: '2001-01-01', dateTo: '2001-01-02' },
        arrivalDate: '2001-01-01',
        search: { kind: 'CODE', code: 'RSV-3F9A1C7B' },
      });

      expect(refsOf(page)).toEqual([wanted.reservationRef]);
    });

    it('DOCUMENT: el documento exacto del titular, no uno que lo contiene', async () => {
      const wanted = await direct({
        guest: aGuest({ documentNumber: '1144093552' }),
      });
      await direct({ guest: aGuest({ documentNumber: '11440935520' }) });

      const page = await list({
        search: { kind: 'DOCUMENT', documentNumber: '1144093552' },
      });

      expect(refsOf(page)).toEqual([wanted.reservationRef]);
    });

    it('DOCUMENT se combina con los demás filtros', async () => {
      await direct({
        status: 'CANCELLED',
        guest: aGuest({ documentNumber: '1144093552' }),
      });
      const active = await direct({
        guest: aGuest({ documentNumber: '1144093552' }),
      });

      const page = await list({
        status: 'ACTIVE',
        search: { kind: 'DOCUMENT', documentNumber: '1144093552' },
      });

      expect(refsOf(page)).toEqual([active.reservationRef]);
    });

    it('NAME: parte del nombre completo, sin distinguir mayúsculas ni tildes', async () => {
      const wanted = await direct({
        guest: aGuest({ firstName: 'José', lastName: 'Muñoz Peña' }),
      });
      await direct({ guest: aGuest({ firstName: 'Ana', lastName: 'Pérez' }) });

      for (const name of ['jose', 'MUNOZ', 'Peñ', 'pena']) {
        expect(refsOf(await list({ search: { kind: 'NAME', name } }))).toEqual([
          wanted.reservationRef,
        ]);
      }
    });

    it('NAME se combina con los demás filtros', async () => {
      await direct({
        startDate: '2026-11-01',
        endDate: '2026-11-03',
        guest: aGuest({ firstName: 'Ana', lastName: 'Pérez' }),
      });
      const inRange = await direct({
        startDate: '2026-12-01',
        endDate: '2026-12-03',
        guest: aGuest({ firstName: 'Ana', lastName: 'Pérez' }),
      });

      const page = await list({
        stayRange: { dateFrom: '2026-12-01', dateTo: '2026-12-01' },
        search: { kind: 'NAME', name: 'perez' },
      });

      expect(refsOf(page)).toEqual([inRange.reservationRef]);
    });

    it('el total cuenta con la misma búsqueda', async () => {
      for (let i = 0; i < 12; i++) {
        await direct({ guest: aGuest({ lastName: 'Ospina' }) });
      }
      await direct({ guest: aGuest({ lastName: 'Zuluaga' }) });

      const page = await list({ search: { kind: 'NAME', name: 'ospina' } });

      expect(page.totalItems).toBe(12);
      expect(page.items).toHaveLength(10);
    });
  });

  it('las habitaciones de una reserva no la duplican en el total', async () => {
    await direct({
      rooms: [
        aDirectRoom(),
        aDirectRoom(),
        aDirectRoom({ roomId: randomUUID() }),
      ],
    });

    expect((await list()).totalItems).toBe(1);
  });
});
