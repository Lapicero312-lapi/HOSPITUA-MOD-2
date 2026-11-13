import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { DAILY_LIST_PUBLISHER } from '../../application/ports/out/daily-list-publisher.js';
import { InboundConsumersRegistrar } from '../in/messaging/inbound-consumers.registrar.js';
import { RabbitDailyListPublisher } from '../out/messaging/rabbit-daily-list.publisher.js';
import type { EnvironmentVariables } from './env.validation.js';
import { rabbitMqOptions } from './rabbitmq.options.js';

/**
 * La conexión con RabbitMQ (`RABBITMQ_URL`), lo que declara el Módulo 2 al conectarse, el registro de
 * sus consumidores y el publicador de la lista del día (`DAILY_LIST_PUBLISHER`). Es global: los
 * publicadores inyectan `AmqpConnection` sin importarlo, y los casos de uso, `DAILY_LIST_PUBLISHER`. Lo
 * importa `AppModule` desde el primer consumidor (`CheckInConsumer`).
 */
@Global()
@Module({
  imports: [
    DiscoveryModule,
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        rabbitMqOptions(config.get('RABBITMQ_URL', { infer: true })),
    }),
  ],
  providers: [
    InboundConsumersRegistrar,
    { provide: DAILY_LIST_PUBLISHER, useClass: RabbitDailyListPublisher },
  ],
  exports: [RabbitMQModule, DAILY_LIST_PUBLISHER],
})
export class MessagingModule {}
