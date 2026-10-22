import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DuplicateOtaError } from '../../../src/application/ports/out/ota.repository.js';
import { Ota } from '../../../src/domain/ota/ota.js';
import { TypeOrmGuestRepository } from '../../../src/infrastructure/out/persistence/repositories/guest.repository.js';
import { TypeOrmOtaRepository } from '../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aGuest, anOta } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

describe('Repositorios de titulares y agencias contra PostgreSQL real', () => {
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

  describe('TypeOrmGuestRepository.findLatestByDocument', () => {
    it('devuelve el titular de la reserva más reciente con ese documento', async () => {
      const reservations = new TypeOrmReservationRepository(dataSource);
      const guests = new TypeOrmGuestRepository(dataSource);
      await reservations.insert(
        aDirectReservation({
          guest: aGuest({ contactPhone: '+57 300 viejo' }),
        }),
      );
      const latest = aGuest({ contactPhone: '+57 300 nuevo' });
      await reservations.insert(aDirectReservation({ guest: latest }));

      const found = await guests.findLatestByDocument('CC', '1144093552');

      expect(found?.id).toBe(latest.id);
      expect(found?.contactPhone).toBe('+57 300 nuevo');
    });

    it('distingue el tipo de documento y devuelve null si no hay ninguno', async () => {
      await new TypeOrmReservationRepository(dataSource).insert(
        aDirectReservation(),
      );
      const guests = new TypeOrmGuestRepository(dataSource);

      expect(await guests.findLatestByDocument('PAS', '1144093552')).toBeNull();
      expect(await guests.findLatestByDocument('CC', '999')).toBeNull();
    });
  });

  describe('TypeOrmOtaRepository', () => {
    it('guarda, busca por id y por nombre, y actualiza la agencia', async () => {
      const otas = new TypeOrmOtaRepository(dataSource);
      const ota = anOta();

      const saved = await otas.insert(ota);
      expect(saved).toEqual(ota);
      expect(await otas.findByName('Booking.com')).toEqual(ota);

      const updated = await otas.update(
        Ota.restore({
          ...ota.snapshot(),
          commissionPercentage: '18.5',
          connectionStatus: 'DISCONNECTED',
        }),
      );
      expect(updated.commissionPercentage).toBe('18.5');
      expect((await otas.findById(ota.id))?.connectionStatus).toBe(
        'DISCONNECTED',
      );
    });

    it('un nombre o una cuenta del hotel repetidos son DuplicateOtaError', async () => {
      const otas = new TypeOrmOtaRepository(dataSource);
      await otas.insert(anOta());

      await expect(
        otas.insert(anOta({ hotelAccountId: 'otra-cuenta' })),
      ).rejects.toEqual(new DuplicateOtaError('name'));
      await expect(otas.insert(anOta({ name: 'Expedia' }))).rejects.toEqual(
        new DuplicateOtaError('hotelAccountId'),
      );
    });

    it('una agencia que no existe es null', async () => {
      expect(
        await new TypeOrmOtaRepository(dataSource).findByName('Expedia'),
      ).toBeNull();
    });
  });
});
