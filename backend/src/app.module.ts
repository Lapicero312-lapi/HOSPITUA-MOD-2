import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { ClockModule } from './infrastructure/out/clock/clock.module.js';
import { ApiErrorFilter } from './infrastructure/shared/api-error.filter.js';

@Module({
  imports: [AppConfigModule, ClockModule],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
