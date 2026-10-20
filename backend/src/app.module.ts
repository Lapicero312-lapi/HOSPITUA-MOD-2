import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { ApiErrorFilter } from './infrastructure/shared/api-error.filter.js';
import { validationExceptionFactory } from './infrastructure/shared/validation-exception.factory.js';

@Module({
  imports: [AppConfigModule],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
})
export class AppModule {}
