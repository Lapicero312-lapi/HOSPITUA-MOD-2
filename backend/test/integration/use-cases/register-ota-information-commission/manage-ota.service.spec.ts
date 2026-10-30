import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ManageOtaService } from '../../../../src/application/use-cases/register-ota-information-commission/manage-ota.service.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from '../../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { anOta, anOtaReservation } from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

const AT = new Date('2026-10-30T14:00:00.000Z');

describe('ManageOta contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let otas: TypeOrmOtaRepository;
  let manage: ManageOtaService;
  let transactions: TypeOrmTransactionRunner;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    otas = new TypeOrmOtaRepository(dataSource);
    manage = new ManageOtaService(otas);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('US3 escenario 1: registra la agencia en CONNECTED, con linkedAt y sin porcentaje', async () => {
    const ota = await manage.register({ name: 'Booking.com' }, AT);

    expect(ota).toMatchObject({
      name: 'Booking.com',
      commissionPercentage: null,
      connectionStatus: 'CONNECTED',
    });
    expect(ota.linkedAt).toEqual(AT);
    expect(ota.lastSyncAt).toEqual(AT);
  });

  it('US3 escenario 2: al reiniciar no crea otra agencia y conserva su porcentaje y su linkedAt', async () => {
    const first = await manage.register({ name: 'Booking.com' }, AT);
    await transactions.run((tx) =>
      manage.setCommissionPercentage(tx, first.id, '15.00'),
    );

    const again = await manage.register(
      { name: 'Booking.com' },
      new Date('2026-11-02T14:00:00.000Z'),
    );

    expect(again.id).toBe(first.id);
    expect(again.commissionPercentage).toBe('15');
    expect(again.linkedAt).toEqual(AT);
    const rows: unknown[] = await dataSource.query('SELECT id FROM ota');
    expect(rows).toHaveLength(1);
  });

  it('un nombre vacío es INVALID_OTA_DATA', async () => {
    await expect(manage.register({ name: '  ' }, AT)).rejects.toMatchObject({
      errorCode: 'INVALID_OTA_DATA',
    });
  });

  it('guarda el porcentaje de la primera reserva y después ya no lo cambia', async () => {
    const ota = await manage.register({ name: 'Booking.com' }, AT);

    await transactions.run((tx) =>
      manage.setCommissionPercentage(tx, ota.id, '15.00'),
    );
    await transactions.run((tx) =>
      manage.setCommissionPercentage(tx, ota.id, '18.00'),
    );

    expect((await otas.findById(ota.id))?.commissionPercentage).toBe('15');
  });

  it('el porcentaje se guarda en la transacción de quien llama: si se revierte, la agencia sigue sin porcentaje', async () => {
    const ota = await manage.register({ name: 'Booking.com' }, AT);

    await expect(
      transactions.run(async (tx) => {
        await manage.setCommissionPercentage(tx, ota.id, '15.00');
        throw new Error('falló el registro de la reserva');
      }),
    ).rejects.toThrow('falló el registro de la reserva');

    expect((await otas.findById(ota.id))?.commissionPercentage).toBeNull();
  });

  it.each([
    ['fuera de 0 a 100', '100.01', 'INVALID_OTA_DATA'],
    ['de una agencia que no existe', '15.00', 'OTA_NOT_FOUND'],
  ])('un porcentaje %s se rechaza', async (_, percentage, errorCode) => {
    const ota = await manage.register({ name: 'Booking.com' }, AT);
    const otaId =
      errorCode === 'OTA_NOT_FOUND'
        ? '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90'
        : ota.id;

    await expect(
      transactions.run((tx) =>
        manage.setCommissionPercentage(tx, otaId, percentage),
      ),
    ).rejects.toMatchObject({ errorCode });
  });
});

describe('ReservationRepository.existsOtaConfirmationCode contra PostgreSQL real', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('dice si la agencia ya tiene una reserva con ese código, y distingue la agencia', async () => {
    const otas = new TypeOrmOtaRepository(dataSource);
    const reservations = new TypeOrmReservationRepository(dataSource);
    const booking = await otas.insert(anOta());
    const expedia = await otas.insert(anOta({ name: 'Expedia' }));
    // El código de confirmación de las reservas OTA de las pruebas (`otaTerms`).
    const code = '4417829013';
    await reservations.insert(anOtaReservation(booking.id));

    expect(await reservations.existsOtaConfirmationCode(booking.id, code)).toBe(
      true,
    );
    expect(await reservations.existsOtaConfirmationCode(expedia.id, code)).toBe(
      false,
    );
    expect(
      await reservations.existsOtaConfirmationCode(booking.id, 'otro-codigo'),
    ).toBe(false);
  });
});
