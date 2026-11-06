import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { COMMISSION_AUDIT_REPOSITORY } from '../../../application/ports/out/commission-audit.repository.js';
import { GUEST_REPOSITORY } from '../../../application/ports/out/guest.repository.js';
import { OTA_BOOKING_REVISION_REPOSITORY } from '../../../application/ports/out/ota-booking-revision.repository.js';
import { OTA_REPOSITORY } from '../../../application/ports/out/ota.repository.js';
import { ARI_PENDING_CHANGE_REPOSITORY } from '../../../application/ports/out/ari-pending-change.repository.js';
import { OTA_ROOM_TYPE_MAPPING_REPOSITORY } from '../../../application/ports/out/ota-room-type-mapping.repository.js';
import { PROCESSED_MESSAGE_REPOSITORY } from '../../../application/ports/out/processed-message.repository.js';
import { RESERVATION_QUERY_PORT } from '../../../application/ports/out/reservation-query.port.js';
import { RESERVATION_REPOSITORY } from '../../../application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../application/ports/out/transaction.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { typeOrmOptions } from '../../config/typeorm.options.js';
import { TypeOrmProcessedMessageRepository } from '../messaging/processed-message.repository.js';
import { TypeOrmCommissionAuditRepository } from './repositories/commission-audit.repository.js';
import { TypeOrmGuestRepository } from './repositories/guest.repository.js';
import { TypeOrmAriPendingChangeRepository } from './repositories/ari-pending-change.repository.js';
import { TypeOrmOtaRoomTypeMappingRepository } from './repositories/ota-room-type-mapping.repository.js';
import { TypeOrmOtaBookingRevisionRepository } from './repositories/ota-booking-revision.repository.js';
import { TypeOrmOtaRepository } from './repositories/ota.repository.js';
import { TypeOrmReservationQuery } from './repositories/reservation-query.repository.js';
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
    { provide: RESERVATION_QUERY_PORT, useClass: TypeOrmReservationQuery },
    { provide: GUEST_REPOSITORY, useClass: TypeOrmGuestRepository },
    { provide: OTA_REPOSITORY, useClass: TypeOrmOtaRepository },
    {
      provide: COMMISSION_AUDIT_REPOSITORY,
      useClass: TypeOrmCommissionAuditRepository,
    },
    {
      provide: OTA_BOOKING_REVISION_REPOSITORY,
      useClass: TypeOrmOtaBookingRevisionRepository,
    },
    {
      provide: OTA_ROOM_TYPE_MAPPING_REPOSITORY,
      useClass: TypeOrmOtaRoomTypeMappingRepository,
    },
    {
      provide: ARI_PENDING_CHANGE_REPOSITORY,
      useClass: TypeOrmAriPendingChangeRepository,
    },
    {
      provide: PROCESSED_MESSAGE_REPOSITORY,
      useClass: TypeOrmProcessedMessageRepository,
    },
    { provide: TRANSACTION_RUNNER, useClass: TypeOrmTransactionRunner },
  ],
  exports: [
    RESERVATION_REPOSITORY,
    RESERVATION_QUERY_PORT,
    GUEST_REPOSITORY,
    OTA_REPOSITORY,
    COMMISSION_AUDIT_REPOSITORY,
    OTA_BOOKING_REVISION_REPOSITORY,
    OTA_ROOM_TYPE_MAPPING_REPOSITORY,
    ARI_PENDING_CHANGE_REPOSITORY,
    PROCESSED_MESSAGE_REPOSITORY,
    TRANSACTION_RUNNER,
  ],
})
export class PersistenceModule {}
