import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LookupGuestService } from '../../../src/application/use-cases/generate-direct-reservation/lookup-guest.service.js';
import { TypeOrmGuestRepository } from '../../../src/infrastructure/out/persistence/repositories/guest.repository.js';
import { TypeOrmReservationRepository } from '../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import { aDirectReservation, aGuest } from '../../support/builders.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

/** El titular `CC 123` del escenario 10 del spec. */
const CC_123 = { documentType: 'CC', documentNumber: '123' } as const;

describe('LookupGuest contra PostgreSQL real (plan, E)', () => {
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let lookupGuest: LookupGuestService;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    reservations = new TypeOrmReservationRepository(dataSource);
    lookupGuest = new LookupGuestService(
      new TypeOrmGuestRepository(dataSource),
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('escenario 10: con dos reservas anteriores del mismo documento, devuelve los datos de la más reciente', async () => {
    await reservations.insert(
      aDirectReservation({
        guest: aGuest({ ...CC_123, contactPhone: '+57 300 111 1111' }),
      }),
    );
    const latest = aGuest({
      ...CC_123,
      firstName: 'Ana',
      lastName: 'Pérez',
      contactPhone: '+57 300 000 0000',
      contactEmail: 'ana@correo.com',
    });
    await reservations.insert(aDirectReservation({ guest: latest }));

    const found = await lookupGuest.execute('CC', '123');

    expect(found?.snapshot()).toEqual(latest.snapshot());
  });

  it('escenario 10: la reserva nueva guarda su propio titular y la anterior no cambia', async () => {
    const previous = aDirectReservation({ guest: aGuest(CC_123) });
    await reservations.insert(previous);
    const preloaded = await lookupGuest.execute('CC', '123');

    // La Recepcionista copia los datos precargados y corrige el teléfono: es un titular nuevo.
    const copy = aGuest({
      ...preloaded?.snapshot(),
      id: crypto.randomUUID(),
      contactPhone: '+57 310 999 9999',
    });
    const next = aDirectReservation({ guest: copy });
    await reservations.insert(next);

    const stored = await reservations.findByRef(previous.reservationRef);
    expect(stored?.guest.snapshot()).toEqual(previous.guest.snapshot());
    expect((await lookupGuest.execute('CC', '123'))?.id).toBe(copy.id);
  });

  it('escenario 11: con un documento que no aparece en ninguna reserva no precarga nada, sin error', async () => {
    await reservations.insert(aDirectReservation({ guest: aGuest(CC_123) }));

    await expect(lookupGuest.execute('CC', '999')).resolves.toBeNull();
    await expect(lookupGuest.execute('TI', '123')).resolves.toBeNull();
  });
});
