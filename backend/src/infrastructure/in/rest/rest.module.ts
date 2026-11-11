import { Module } from '@nestjs/common';
import { CalculateDynamicRateModule } from '../../../application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CancelReservationModule } from '../../../application/use-cases/cancel-reservation/cancel-reservation.module.js';
import { CheckViewReservationModule } from '../../../application/use-cases/check-view-reservation/check-view-reservation.module.js';
import { ConsultRoomInventoryModule } from '../../../application/use-cases/consult-room-inventory/consult-room-inventory.module.js';
import { ExportSireFileModule } from '../../../application/use-cases/export-sire-file/export-sire-file.module.js';
import { GenerateDirectReservationModule } from '../../../application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';
import { ProcessGuestDataModule } from '../../../application/use-cases/process-guest-data/process-guest-data.module.js';
import { RegisterOtaInformationCommissionModule } from '../../../application/use-cases/register-ota-information-commission/register-ota-information-commission.module.js';
import { DirectReservationsController } from './direct-reservations.controller.js';
import { GuestStaysController } from './guest-stays.controller.js';
import { GuestsController } from './guests.controller.js';
import { OtasController } from './otas.controller.js';
import { RatesController } from './rates.controller.js';
import { ReservationsController } from './reservations.controller.js';
import { RoomsController } from './rooms.controller.js';
import { SireController } from './sire.controller.js';
import { sireRequestLimitsProvider } from './sire-rate-limiter.js';

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
  ],
  // Los límites de `POST /api/sire/exports`: una sola cuenta para todas las solicitudes (T005).
  providers: [sireRequestLimitsProvider],
})
export class RestModule {}
