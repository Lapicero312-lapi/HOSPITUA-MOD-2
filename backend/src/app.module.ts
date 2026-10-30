import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigureOtaModule } from './application/use-cases/configure-ota/configure-ota.module.js';
import { RegisterOtaInformationCommissionModule } from './application/use-cases/register-ota-information-commission/register-ota-information-commission.module.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { JobsModule } from './infrastructure/in/jobs/jobs.module.js';
import { ChannexClientModule } from './infrastructure/out/channex/channex-client.module.js';
import { ClockModule } from './infrastructure/out/clock/clock.module.js';
import { Module1ClientModule } from './infrastructure/out/module1/module1-client.module.js';
import { Module3ClientModule } from './infrastructure/out/module3/module3-client.module.js';
import { PersistenceModule } from './infrastructure/out/persistence/persistence.module.js';
import { ApiErrorFilter } from './infrastructure/shared/api-error.filter.js';
import { LoggingModule } from './infrastructure/shared/logging.module.js';

/**
 * El Módulo 2: la configuración, la infraestructura global (base de datos, reloj y clientes de los otros
 * módulos y de Channex), los módulos de los casos de uso (plan base, regla 4 de la arquitectura) y las
 * tareas programadas.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PersistenceModule,
    ClockModule,
    Module1ClientModule,
    Module3ClientModule,
    ChannexClientModule,
    RegisterOtaInformationCommissionModule,
    ConfigureOtaModule,
    JobsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
