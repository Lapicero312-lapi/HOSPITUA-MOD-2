import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUEST_REPOSITORY,
  type GuestRepository,
} from '../../../src/application/ports/out/guest.repository.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import { AppConfigModule } from '../../../src/infrastructure/config/app-config.module.js';
import { PersistenceModule } from '../../../src/infrastructure/out/persistence/persistence.module.js';
import { aDirectReservation } from '../../support/builders.js';
import { integrationEnv } from '../support/database.js';

describe('PersistenceModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // La configuración de Nest lee la conexión de las variables de entorno, como en producción.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PersistenceModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('une cada puerto con su adaptador y guarda en la misma transacción', async () => {
    const reservations = moduleRef.get<ReservationRepository>(
      RESERVATION_REPOSITORY,
    );
    const transactions = moduleRef.get<TransactionRunner>(TRANSACTION_RUNNER);
    const reservation = aDirectReservation();

    await transactions.run((tx) => reservations.insert(reservation, tx));

    expect((await reservations.findByRef(reservation.reservationRef))?.id).toBe(
      reservation.id,
    );
    expect(moduleRef.get<GuestRepository>(GUEST_REPOSITORY)).toBeDefined();
    expect(moduleRef.get<OtaRepository>(OTA_REPOSITORY)).toBeDefined();
  });
});
