import { DataSource } from 'typeorm';
import { inject } from 'vitest';
import { validateEnv } from '../../../src/infrastructure/config/env.validation.js';
import { typeOrmOptions } from '../../../src/infrastructure/config/typeorm.options.js';
import type { IntegrationEnv } from '../global-setup.js';

/**
 * Las variables de entorno de los contenedores de las pruebas (`DB_*` y `RABBITMQ_URL`). Sirven para
 * `validateEnv` o para una aplicación de Nest que se levante contra ellos.
 */
export function integrationEnv(): IntegrationEnv {
  return inject('integrationEnv');
}

/** Un `DataSource` conectado al PostgreSQL de las pruebas, con el esquema ya migrado. */
export async function openTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource(
    typeOrmOptions(validateEnv({ NODE_ENV: 'test', ...integrationEnv() })),
  );
  return dataSource.initialize();
}

/**
 * Vacía todas las tablas del modelo (no la de migraciones), para que cada prueba empiece sin datos de
 * otra. Se llama en un `beforeEach`.
 */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  const tables: { tablename: string }[] = await dataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'migrations'`,
  );
  if (tables.length > 0) {
    const names = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
    await dataSource.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  }
}
