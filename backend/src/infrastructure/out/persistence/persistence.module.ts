import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GUEST_REPOSITORY } from '../../../application/ports/out/guest.repository.js';
import { OTA_REPOSITORY } from '../../../application/ports/out/ota.repository.js';
import { RESERVATION_REPOSITORY } from '../../../application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../application/ports/out/transaction.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { typeOrmOptions } from '../../config/typeorm.options.js';
import { TypeOrmGuestRepository } from './repositories/guest.repository.js';
import { TypeOrmOtaRepository } from './repositories/ota.repository.js';
import { TypeOrmReservationRepository } from './repositories/reservation.repository.js';
import { TypeOrmTransactionRunner } from './typeorm-transaction.js';

/**
 * Conexión a PostgreSQL y los repositorios del Módulo 2. Une cada puerto con su adaptador por su símbolo
 * (plan base, regla 4). Es global: los casos de uso inyectan `@Inject(RESERVATION_REPOSITORY)` sin
 * importar este módulo.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        typeOrmOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_NAME: config.get('DB_NAME', { infer: true }),
          DB_USER: config.get('DB_USER', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
        }),
    }),
  ],
  providers: [
    { provide: RESERVATION_REPOSITORY, useClass: TypeOrmReservationRepository },
    { provide: GUEST_REPOSITORY, useClass: TypeOrmGuestRepository },
    { provide: OTA_REPOSITORY, useClass: TypeOrmOtaRepository },
    { provide: TRANSACTION_RUNNER, useClass: TypeOrmTransactionRunner },
  ],
  exports: [
    RESERVATION_REPOSITORY,
    GUEST_REPOSITORY,
    OTA_REPOSITORY,
    TRANSACTION_RUNNER,
  ],
})
export class PersistenceModule {}
