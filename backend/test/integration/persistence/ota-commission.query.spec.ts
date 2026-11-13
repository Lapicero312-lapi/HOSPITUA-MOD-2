import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OtaCommissionFilters } from '../../../src/application/ports/out/reservation-query.port.js';
import type { ReservationProps } from '../../../src/domain/reservation/reservation.js';
import type { OtaTerms } from '../../../src/domain/reservation/reservation.js';
import { Money } from '../../../src/domain/shared/money.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationQuery } from '../../../src/infrastructure/out/persistence/repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El periodo de la consulta, sobre la `end_date`: del 2026-10-20 al 2026-10-25, los dos incluidos. */
const FROM = '2026-10-20';
const TO = '2026-10-25';

describe('TypeOrmReservationQuery.listOtaCommissions contra PostgreSQL real (register-ota-information-commission, A1 y C1; T011)', () => {
  let dataSource: DataSource;
  let query: TypeOrmReservationQuery;
  let reservations: TypeOrmReservationRepository;
  let booking: string;
  let expedia: string;

  const filters = (
    changes: Partial<OtaCommissionFilters> = {},
  ): OtaCommissionFilters => ({
    dateFrom: FROM,
    dateTo: TO,
    commissionStatus: null,
    reservationStatus: null,
    otaId: null,
    ...changes,
  });

  /** Una reserva de la agencia que sale el `endDate` (llega dos días antes). */
  const anOtaLeaving = (
    otaId: string,
    endDate: string,
    changes: Partial<ReservationProps> = {},
    terms: Partial<OtaTerms> = {},
  ) => {
    const end = new Date(`${endDate}T00:00:00Z`);
    const start = new Date(end.getTime() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return reservations.insert(
      anOtaReservation(otaId, {
        startDate: start,
        endDate,
        ota: otaTerms(otaId, {
          externalConfirmationCode: `${endDate.replaceAll('-', '')}${Math.floor(Math.random() * 1e6)}`,
          ...terms,
        }),
        ...changes,
      }),
    );
  };

  const refsOf = async (changes: Partial<OtaCommissionFilters> = {}) =>
    (await query.listOtaCommissions(filters(changes), 1)).items.map(
      (row) => row.reservationRef,
    );

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    query = new TypeOrmReservationQuery(dataSource);
    reservations = new TypeOrmReservationRepository(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const otas = new TypeOrmOtaRepository(dataSource);
    const first = anOta({ name: 'Booking.com' });
    const second = anOta({ name: 'Expedia' });
    await otas.insert(first);
    await otas.insert(second);
    booking = first.id;
    expedia = second.id;
  });

  afterAll(async () => {
    await truncateAllTables(dataSource);
    await dataSource.destroy();
  });

  it('una fila con los campos de A1: el nombre de la agencia, los importes y el porcentaje congelado', async () => {
    const saved = await anOtaLeaving(
      booking,
      '2026-10-22',
      { status: 'COMPLETED' },
      {
        externalConfirmationCode: '4417829013',
        grossAmount: Money.of('400', 'USD'),
        commissionPercentage: '15',
        commissionAmount: Money.of('60', 'USD'),
      },
    );

    const page = await query.listOtaCommissions(filters(), 1);

    expect(page.totalItems).toBe(1);
    const [row] = page.items;
    expect(row).toMatchObject({
      reservationRef: saved.reservationRef,
      otaId: booking,
      otaName: 'Booking.com',
      externalConfirmationCode: '4417829013',
      status: 'COMPLETED',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      commissionPercentage: '15.00',
      commissionStatus: 'CALCULATED',
    });
    expect(row.grossAmount.equals(Money.of('400.00', 'USD'))).toBe(true);
    expect(row.commissionAmount.equals(Money.of('60.00', 'USD'))).toBe(true);
  });

  it('solo las de canal OTA: una directa en el periodo no sale', async () => {
    await reservations.insert(
      aDirectReservation({ startDate: '2026-10-20', endDate: '2026-10-22' }),
    );
    const ota = await anOtaLeaving(booking, '2026-10-22');

    expect(await refsOf()).toEqual([ota.reservationRef]);
  });

  it('el rango es inclusivo sobre end_date: entran las que salen el primer y el último día, no las de un día antes o después', async () => {
    await anOtaLeaving(booking, '2026-10-19');
    const first = await anOtaLeaving(booking, '2026-10-20');
    const last = await anOtaLeaving(booking, '2026-10-25');
    await anOtaLeaving(booking, '2026-10-26');

    expect(await refsOf()).toEqual([first.reservationRef, last.reservationRef]);
  });

  it('el rango es sobre end_date, no sobre start_date: una que llegó antes del periodo y sale dentro, entra', async () => {
    const saved = await reservations.insert(
      anOtaReservation(booking, {
        startDate: '2026-10-01',
        endDate: '2026-10-21',
        ota: otaTerms(booking, { externalConfirmationCode: '1000000001' }),
      }),
    );
    await reservations.insert(
      anOtaReservation(booking, {
        startDate: '2026-10-21',
        endDate: '2026-10-30',
        ota: otaTerms(booking, { externalConfirmationCode: '1000000002' }),
      }),
    );

    expect(await refsOf()).toEqual([saved.reservationRef]);
  });

  it('filtra por commissionStatus', async () => {
    await anOtaLeaving(booking, '2026-10-21');
    const reconciled = await anOtaLeaving(
      booking,
      '2026-10-22',
      {},
      { commissionStatus: 'RECONCILED' },
    );

    expect(await refsOf({ commissionStatus: 'RECONCILED' })).toEqual([
      reconciled.reservationRef,
    ]);
    expect(await refsOf({ commissionStatus: 'PAID' })).toEqual([]);
  });

  it('filtra por reservationStatus', async () => {
    await anOtaLeaving(booking, '2026-10-21', { status: 'ACTIVE' });
    const completed = await anOtaLeaving(booking, '2026-10-22', {
      status: 'COMPLETED',
    });

    expect(await refsOf({ reservationStatus: 'COMPLETED' })).toEqual([
      completed.reservationRef,
    ]);
  });

  it('filtra por otaId; una agencia sin reservas da items vacío', async () => {
    await anOtaLeaving(booking, '2026-10-21');
    const fromExpedia = await anOtaLeaving(expedia, '2026-10-22');

    expect(await refsOf({ otaId: expedia })).toEqual([
      fromExpedia.reservationRef,
    ]);
    expect(
      await refsOf({ otaId: '00000000-0000-4000-8000-000000000000' }),
    ).toEqual([]);
  });

  it('ordena por end_date y después por reservation_ref, ascendentes', async () => {
    const saved = [
      await anOtaLeaving(booking, '2026-10-23'),
      await anOtaLeaving(booking, '2026-10-21'),
      await anOtaLeaving(booking, '2026-10-23'),
      await anOtaLeaving(booking, '2026-10-21'),
    ];
    const expected = [...saved]
      .sort(
        (a, b) =>
          a.endDate.localeCompare(b.endDate) ||
          a.reservationRef.localeCompare(b.reservationRef),
      )
      .map((r) => r.reservationRef);

    expect(await refsOf()).toEqual(expected);
  });

  it('de a 100: con 101, la página 1 trae 100, la 2 trae 1, y una que pasa de la última, items vacío con el total real', async () => {
    for (let i = 0; i < 101; i++) {
      await anOtaLeaving(booking, '2026-10-22');
    }

    const first = await query.listOtaCommissions(filters(), 1);
    const second = await query.listOtaCommissions(filters(), 2);
    const beyond = await query.listOtaCommissions(filters(), 3);

    expect(first.items).toHaveLength(100);
    expect(first.totalItems).toBe(101);
    expect(second.items).toHaveLength(1);
    expect(second.totalItems).toBe(101);
    expect(beyond).toEqual({ totalItems: 101, items: [] });
    // La de la página 2 es la que sigue a las 100 de la 1, sin repetir.
    expect(first.items.map((r) => r.reservationRef)).not.toContain(
      second.items[0].reservationRef,
    );
  });
});
