import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { LoggingModule } from './infrastructure/shared/logging.module.js';

@Module({
  imports: [AppConfigModule, LoggingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
