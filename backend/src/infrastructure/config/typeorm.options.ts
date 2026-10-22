import type { DataSourceOptions } from 'typeorm';
import { MIGRATIONS } from '../../migrations/index.js';
import type { EnvironmentVariables } from './env.validation.js';

/**
 * Opciones de TypeORM a partir de la configuración ya validada.
 * Las usan la CLI de migraciones (data-source.ts) y, más adelante, la aplicación (T008).
 */
export function typeOrmOptions(env: EnvironmentVariables): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    // El esquema lo definen las migraciones SQL (decisión D11): nunca se genera desde las clases.
    synchronize: false,
    migrationsRun: false,
    migrations: MIGRATIONS,
    // Cada migración en su propia transacción: si una falla, no queda a medias.
    migrationsTransactionMode: 'each',
    entities: [],
  };
}
