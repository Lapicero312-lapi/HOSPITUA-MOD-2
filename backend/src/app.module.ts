import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CalculateDynamicRateModule } from './application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CheckRoomAvailabilityModule } from './application/use-cases/check-room-availability/check-room-availability.module.js';
import { CheckViewReservationModule } from './application/use-cases/check-view-reservation/check-view-reservation.module.js';
import { ConfigureOtaModule } from './application/use-cases/configure-ota/configure-ota.module.js';
import { ConsultMaintenanceCalendarModule } from './application/use-cases/consult-maintenance-calendar/consult-maintenance-calendar.module.js';
import { ConsultRoomInventoryModule } from './application/use-cases/consult-room-inventory/consult-room-inventory.module.js';
import { GenerateDirectReservationModule } from './application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';
import { GenerateOtaReservationModule } from './application/use-cases/generate-ota-reservation/generate-ota-reservation.module.js';
import { ProcessGuestDataModule } from './application/use-cases/process-guest-data/process-guest-data.module.js';
import { RegisterOtaInformationCommissionModule } from './application/use-cases/register-ota-information-commission/register-ota-information-commission.module.js';
import { UpdateReservationModule } from './application/use-cases/update-reservation/update-reservation.module.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { MessagingModule } from './infrastructure/config/messaging.module.js';
import { RateReferenceConfigModule } from './infrastructure/config/rate-reference.config.js';
import { JobsModule } from './infrastructure/in/jobs/jobs.module.js';
import { ConsumersModule } from './infrastructure/in/messaging/consumers.module.js';
import { RestModule } from './infrastructure/in/rest/rest.module.js';
import { ChannexClientModule } from './infrastructure/out/channex/channex-client.module.js';
import { ClockModule } from './infrastructure/out/clock/clock.module.js';
import { Module1ClientModule } from './infrastructure/out/module1/module1-client.module.js';
import { Module3ClientModule } from './infrastructure/out/module3/module3-client.module.js';
import { PersistenceModule } from './infrastructure/out/persistence/persistence.module.js';
import { ApiErrorFilter } from './infrastructure/shared/api-error.filter.js';
import { LoggingModule } from './infrastructure/shared/logging.module.js';

/**
 * El Módulo 2: la configuración, la infraestructura global (base de datos, reloj, RabbitMQ y clientes de
 * los otros módulos y de Channex), los módulos de los casos de uso (plan base, regla 4 de la arquitectura)
 * y las tareas programadas, los consumidores de colas y los controladores REST.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PersistenceModule,
    ClockModule,
    RateReferenceConfigModule,
    Module1ClientModule,
    Module3ClientModule,
    ChannexClientModule,
    MessagingModule,
    RegisterOtaInformationCommissionModule,
    ConfigureOtaModule,
    ConsultMaintenanceCalendarModule,
    ConsultRoomInventoryModule,
    CheckViewReservationModule,
    CheckRoomAvailabilityModule,
    CalculateDynamicRateModule,
    GenerateDirectReservationModule,
    GenerateOtaReservationModule,
    ProcessGuestDataModule,
    UpdateReservationModule,
    JobsModule,
    ConsumersModule,
    RestModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
