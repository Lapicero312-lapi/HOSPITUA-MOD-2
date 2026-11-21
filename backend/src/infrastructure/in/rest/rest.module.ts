import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CalculateDynamicRateModule } from '../../../application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CancelReservationModule } from '../../../application/use-cases/cancel-reservation/cancel-reservation.module.js';
import { CheckViewReservationModule } from '../../../application/use-cases/check-view-reservation/check-view-reservation.module.js';
import { ConsultRoomInventoryModule } from '../../../application/use-cases/consult-room-inventory/consult-room-inventory.module.js';
import { ExportSireFileModule } from '../../../application/use-cases/export-sire-file/export-sire-file.module.js';
import { GenerateDirectReservationModule } from '../../../application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';
import { ProcessGuestDataModule } from '../../../application/use-cases/process-guest-data/process-guest-data.module.js';
import { RegisterOtaInformationCommissionModule } from '../../../application/use-cases/register-ota-information-commission/register-ota-information-commission.module.js';
import { UpdateReservationModule } from '../../../application/use-cases/update-reservation/update-reservation.module.js';
import { DirectReservationsController } from './direct-reservations.controller.js';
import { GuestStaysController } from './guest-stays.controller.js';
import { GuestsController } from './guests.controller.js';
import {
  InternalKeyGuard,
  MODULE2_INTERNAL_KEY,
} from './internal-key.guard.js';
import { OtaCommissionsController } from './ota-commissions.controller.js';
import { OtasController } from './otas.controller.js';
import { RatesController } from './rates.controller.js';
import { ReconciliationsController } from './reconciliations.controller.js';
import { ReservationsController } from './reservations.controller.js';
import { RoomsController } from './rooms.controller.js';
import { SireController } from './sire.controller.js';
import { sireRequestLimitsProvider } from './sire-rate-limiter.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';

/** Los controladores REST del Módulo 2 y los módulos de los casos de uso que llaman. */
@Module({
  imports: [
    ConsultRoomInventoryModule,
    GenerateDirectReservationModule,
    CalculateDynamicRateModule,
    ProcessGuestDataModule,
    CheckViewReservationModule,
    CancelReservationModule,
    ExportSireFileModule,
    RegisterOtaInformationCommissionModule,
    UpdateReservationModule,
  ],
  controllers: [
    RoomsController,
    GuestsController,
    DirectReservationsController,
    RatesController,
    GuestStaysController,
    ReservationsController,
    SireController,
    OtasController,
    OtaCommissionsController,
    ReconciliationsController,
  ],
  providers: [
    // Los límites de `POST /api/sire/exports`: una sola cuenta para todas las solicitudes (T005).
    sireRequestLimitsProvider,
    // `X-Internal-Key` que se exige a los Módulos 1 y 3 en las rutas marcadas (`MODULE2_INTERNAL_KEY`;
    // vacía, no se exige).
    {
      provide: MODULE2_INTERNAL_KEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MODULE2_INTERNAL_KEY', { infer: true }) || null,
    },
    { provide: APP_GUARD, useClass: InternalKeyGuard },
  ],
})
export class RestModule {}
