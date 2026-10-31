import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUEST_REPOSITORY,
  type GuestRepository,
} from '../../../src/application/ports/out/guest.repository.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../src/application/ports/out/ota.repository.js';
import { PROCESSED_MESSAGE_REPOSITORY } from '../../../src/application/ports/out/processed-message.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../src/application/ports/out/transaction.js';
import { TypeOrmProcessedMessageRepository } from '../../../src/infrastructure/out/messaging/processed-message.repository.js';
import { aDirectReservation } from '../../support/builders.js';
import { integrationEnv } from '../support/database.js';

describe('PersistenceModule', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(async () => {
    // La configuración de Nest lee la conexión de las variables de entorno, como en producción. Los
    // módulos se importan después de asignarlas: AppConfigModule las lee y las valida al importarse,
    // y si se importara antes se conectaría a localhost:5432 y no al contenedor de las pruebas.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppConfigModule } =
      await import('../../../src/infrastructure/config/app-config.module.js');
    const { PersistenceModule } =
      await import('../../../src/infrastructure/out/persistence/persistence.module.js');
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PersistenceModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('une cada puerto con su adaptador y guarda en la misma transacción', async () => {
    if (!moduleRef) {
      throw new Error('El módulo no arrancó');
    }
    expect(moduleRef.get(DataSource).options).toMatchObject({
      host: integrationEnv().DB_HOST,
      port: Number(integrationEnv().DB_PORT),
    });
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
    expect(moduleRef.get(PROCESSED_MESSAGE_REPOSITORY)).toBeInstanceOf(
      TypeOrmProcessedMessageRepository,
    );
  });
});
