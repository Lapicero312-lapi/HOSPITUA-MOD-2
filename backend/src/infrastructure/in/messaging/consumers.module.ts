import { Module } from '@nestjs/common';
import { ConfigureOtaModule } from '../../../application/use-cases/configure-ota/configure-ota.module.js';
import { UpdateReservationModule } from '../../../application/use-cases/update-reservation/update-reservation.module.js';
import { CheckInConsumer } from './check-in.consumer.js';
import { CheckOutConsumer } from './check-out.consumer.js';
import { InventoryConsumer } from './inventory.consumer.js';
import { MaintenanceConsumer } from './maintenance.consumer.js';

/**
 * Los consumidores de las colas de entrada y los módulos de los casos de uso que llaman. Cada uno se
 * conecta a su cola con `InboundConsumersRegistrar` de `MessagingModule`, que importa `AppModule`.
 */
@Module({
  imports: [UpdateReservationModule, ConfigureOtaModule],
  providers: [
    CheckInConsumer,
    CheckOutConsumer,
    MaintenanceConsumer,
    InventoryConsumer,
  ],
})
export class ConsumersModule {}
