import { Module } from '@nestjs/common';
import { CalculateDynamicRateModule } from '../../../application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { ConsultRoomInventoryModule } from '../../../application/use-cases/consult-room-inventory/consult-room-inventory.module.js';
import { GenerateDirectReservationModule } from '../../../application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';
import { GuestsController } from './guests.controller.js';
import { RatesController } from './rates.controller.js';
import { RoomsController } from './rooms.controller.js';

/** Los controladores REST del Módulo 2 y los módulos de los casos de uso que llaman. */
@Module({
  imports: [
    ConsultRoomInventoryModule,
    GenerateDirectReservationModule,
    CalculateDynamicRateModule,
  ],
  controllers: [RoomsController, GuestsController, RatesController],
})
export class RestModule {}
