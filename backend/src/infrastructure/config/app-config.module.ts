import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation.js';

/**
 * Configuración por entorno. Lee, en este orden de prioridad:
 *   1. las variables del sistema,
 *   2. `.env.<NODE_ENV>` (por ejemplo `.env.test`),
 *   3. `.env`.
 * Los archivos `.env*` nunca se suben al repositorio; la plantilla es `.env.example`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
