import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { ChannexClientModule } from './infrastructure/out/channex/channex-client.module.js';
import { ClockModule } from './infrastructure/out/clock/clock.module.js';
import { Module1ClientModule } from './infrastructure/out/module1/module1-client.module.js';
import { Module3ClientModule } from './infrastructure/out/module3/module3-client.module.js';
import { ApiErrorFilter } from './infrastructure/shared/api-error.filter.js';
import { LoggingModule } from './infrastructure/shared/logging.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    ClockModule,
    Module1ClientModule,
    Module3ClientModule,
    ChannexClientModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
