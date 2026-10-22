import pg from 'pg';
import type { DataSourceOptions } from 'typeorm';
import { MIGRATIONS } from '../../migrations/index.js';
import { TABLES } from '../out/persistence/tables/index.js';
import type { EnvironmentVariables } from './env.validation.js';

/** Los datos de conexión que necesita TypeORM. */
export type DatabaseEnv = Pick<
  EnvironmentVariables,
  'DB_HOST' | 'DB_PORT' | 'DB_NAME' | 'DB_USER' | 'DB_PASSWORD'
>;

const keepAsText = (value: string): string => value;

/**
 * Cómo lee `pg` cada tipo de PostgreSQL. Las fechas (`date`) y las fechas con hora (`timestamptz`)
 * llegan como texto, sin pasar por la zona horaria del servidor: las fechas se usan como `AAAA-MM-DD`
 * (plan base) y `updated_at` conserva sus microsegundos para el control de concurrencia. TypeORM
 * convierte a `Date` las columnas `timestamptz` que lo necesitan.
 */
export const PG_TYPES: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) =>
    oid === pg.types.builtins.DATE || oid === pg.types.builtins.TIMESTAMPTZ
      ? keepAsText
      : pg.types.getTypeParser(
          oid,
          format as 'text',
        )) as pg.CustomTypesConfig['getTypeParser'],
};

/**
 * Opciones de TypeORM a partir de la configuración ya validada. Las usan la CLI de migraciones
 * (data-source.ts), la aplicación (PersistenceModule) y las pruebas de integración.
 */
export function typeOrmOptions(env: DatabaseEnv): DataSourceOptions {
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
    entities: TABLES,
    extra: { types: PG_TYPES },
  };
}
