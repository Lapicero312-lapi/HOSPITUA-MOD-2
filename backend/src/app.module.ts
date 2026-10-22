import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { ApiErrorFilter } from './infrastructure/shared/api-error.filter.js';

@Module({
  imports: [AppConfigModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
