import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { InboundConsumersRegistrar } from '../in/messaging/inbound-consumers.registrar.js';
import type { EnvironmentVariables } from './env.validation.js';
import { rabbitMqOptions } from './rabbitmq.options.js';

/**
 * La conexión con RabbitMQ (`RABBITMQ_URL`), lo que declara el Módulo 2 al conectarse y el registro de
 * sus consumidores. Es global: los publicadores inyectan `AmqpConnection` sin importarlo. `AppModule`
 * lo importa cuando exista el primer consumidor o publicador.
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
  providers: [InboundConsumersRegistrar],
  exports: [RabbitMQModule],
})
export class MessagingModule {}
