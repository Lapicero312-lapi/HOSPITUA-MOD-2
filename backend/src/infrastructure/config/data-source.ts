import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { validateEnv } from './env.validation.js';
import { typeOrmOptions } from './typeorm.options.js';

/**
 * DataSource que usa la CLI de TypeORM para las migraciones (`pnpm migration:run`).
 * La CLI corre fuera de Nest, así que aquí se cargan los `.env` con el mismo orden de prioridad que
 * AppConfigModule: las variables del sistema, luego `.env.<NODE_ENV>` y luego `.env`.
 */
for (const file of [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export default new DataSource(typeOrmOptions(validateEnv(process.env)));
