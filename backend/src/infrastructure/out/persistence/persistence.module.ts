import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { COMMISSION_AUDIT_REPOSITORY } from '../../../application/ports/out/commission-audit.repository.js';
import { GUEST_STAY_QUERY } from '../../../application/ports/out/guest-stay.query.js';
import { GUEST_DATA_REPOSITORY } from '../../../application/ports/out/guest-data.repository.js';
import { GUEST_REPOSITORY } from '../../../application/ports/out/guest.repository.js';
import { DAILY_MESSAGE_REPOSITORY } from '../../../application/ports/out/daily-message.repository.js';
import { DAILY_SEQUENCE_REPOSITORY } from '../../../application/ports/out/daily-sequence.repository.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../../application/ports/out/migratory-movement.repository.js';
import { OTA_BOOKING_REVISION_REPOSITORY } from '../../../application/ports/out/ota-booking-revision.repository.js';
import { OTA_REPOSITORY } from '../../../application/ports/out/ota.repository.js';
import { ARI_PENDING_CHANGE_REPOSITORY } from '../../../application/ports/out/ari-pending-change.repository.js';
import { OTA_ROOM_TYPE_MAPPING_REPOSITORY } from '../../../application/ports/out/ota-room-type-mapping.repository.js';
import { PROCESSED_MESSAGE_REPOSITORY } from '../../../application/ports/out/processed-message.repository.js';
import { RESERVATION_QUERY_PORT } from '../../../application/ports/out/reservation-query.port.js';
import { RESERVATION_REPOSITORY } from '../../../application/ports/out/reservation.repository.js';
import { SIRE_EXPORT_REPOSITORY } from '../../../application/ports/out/sire-export.repository.js';
import { CANCELLATION_REPOSITORY } from '../../../application/ports/out/cancellation.repository.js';
import { TRANSACTION_RUNNER } from '../../../application/ports/out/transaction.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { typeOrmOptions } from '../../config/typeorm.options.js';
import { TypeOrmProcessedMessageRepository } from '../messaging/processed-message.repository.js';
import { TypeOrmDailyMessageRepository } from './repositories/daily-message.repository.js';
import { TypeOrmDailySequenceRepository } from './repositories/daily-sequence.repository.js';
import { TypeOrmCommissionAuditRepository } from './repositories/commission-audit.repository.js';
import { TypeOrmGuestDataRepository } from './repositories/guest-data.repository.js';
import { TypeOrmGuestStayQuery } from './repositories/guest-stay.query.js';
import { TypeOrmGuestRepository } from './repositories/guest.repository.js';
import { TypeOrmAriPendingChangeRepository } from './repositories/ari-pending-change.repository.js';
import { TypeOrmOtaRoomTypeMappingRepository } from './repositories/ota-room-type-mapping.repository.js';
import { TypeOrmMigratoryMovementRepository } from './repositories/migratory-movement.repository.js';
import { TypeOrmOtaBookingRevisionRepository } from './repositories/ota-booking-revision.repository.js';
import { TypeOrmOtaRepository } from './repositories/ota.repository.js';
import { TypeOrmReservationQuery } from './repositories/reservation-query.repository.js';
import { TypeOrmReservationRepository } from './repositories/reservation.repository.js';
import { TypeOrmSireExportRepository } from './repositories/sire-export.repository.js';
import { TypeOrmCancellationRepository } from './repositories/cancellation.repository.js';
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
    { provide: GUEST_DATA_REPOSITORY, useClass: TypeOrmGuestDataRepository },
    { provide: GUEST_STAY_QUERY, useClass: TypeOrmGuestStayQuery },
    {
      provide: MIGRATORY_MOVEMENT_REPOSITORY,
      useClass: TypeOrmMigratoryMovementRepository,
    },
    { provide: OTA_REPOSITORY, useClass: TypeOrmOtaRepository },
    {
      provide: DAILY_SEQUENCE_REPOSITORY,
      useClass: TypeOrmDailySequenceRepository,
    },
    {
      provide: DAILY_MESSAGE_REPOSITORY,
      useClass: TypeOrmDailyMessageRepository,
    },
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
    { provide: SIRE_EXPORT_REPOSITORY, useClass: TypeOrmSireExportRepository },
    {
      provide: CANCELLATION_REPOSITORY,
      useClass: TypeOrmCancellationRepository,
    },
    { provide: TRANSACTION_RUNNER, useClass: TypeOrmTransactionRunner },
  ],
  exports: [
    RESERVATION_REPOSITORY,
    RESERVATION_QUERY_PORT,
    GUEST_REPOSITORY,
    GUEST_DATA_REPOSITORY,
    GUEST_STAY_QUERY,
    MIGRATORY_MOVEMENT_REPOSITORY,
    OTA_REPOSITORY,
    DAILY_SEQUENCE_REPOSITORY,
    DAILY_MESSAGE_REPOSITORY,
    COMMISSION_AUDIT_REPOSITORY,
    OTA_BOOKING_REVISION_REPOSITORY,
    OTA_ROOM_TYPE_MAPPING_REPOSITORY,
    ARI_PENDING_CHANGE_REPOSITORY,
    PROCESSED_MESSAGE_REPOSITORY,
    SIRE_EXPORT_REPOSITORY,
    CANCELLATION_REPOSITORY,
    TRANSACTION_RUNNER,
  ],
})
export class PersistenceModule {}
