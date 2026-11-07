import { Module } from '@nestjs/common';
import { CalculateDynamicRateModule } from '../../../application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { ConsultRoomInventoryModule } from '../../../application/use-cases/consult-room-inventory/consult-room-inventory.module.js';
import { GenerateDirectReservationModule } from '../../../application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';
import { ProcessGuestDataModule } from '../../../application/use-cases/process-guest-data/process-guest-data.module.js';
import { GuestStaysController } from './guest-stays.controller.js';
import { GuestsController } from './guests.controller.js';
import { RatesController } from './rates.controller.js';
import { RoomsController } from './rooms.controller.js';

/** Los controladores REST del Módulo 2 y los módulos de los casos de uso que llaman. */
@Module({
  imports: [
    ConsultRoomInventoryModule,
    GenerateDirectReservationModule,
    CalculateDynamicRateModule,
    ProcessGuestDataModule,
  ],
  controllers: [
    RoomsController,
    GuestsController,
    RatesController,
    GuestStaysController,
  ],
})
export class RestModule {}
