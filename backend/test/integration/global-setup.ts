import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';
import { DataSource } from 'typeorm';
import type { TestProject } from 'vitest/node';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import { typeOrmOptions } from '../../src/infrastructure/config/typeorm.options.js';

/** Las mismas imágenes y credenciales que `docker-compose.yml`. */
const POSTGRES_IMAGE = 'postgres:17-alpine';
const RABBITMQ_IMAGE = 'rabbitmq:4-management-alpine';
const USER = 'hospitua';
const PASSWORD = 'hospitua';
const DATABASE = 'hospitua';
const AMQP_PORT = 5672;
const MANAGEMENT_PORT = 15672;

/** Variables de entorno que apuntan a los contenedores de las pruebas de integración. */
export type IntegrationEnv = {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  RABBITMQ_URL: string;
};

declare module 'vitest' {
  export interface ProvidedContext {
    integrationEnv: IntegrationEnv;
    rabbitmqManagementUrl: string;
  }
}

/**
 * Arranca un PostgreSQL y un RabbitMQ limpios con Testcontainers, una vez para todas las pruebas de
 * integración (plan base, "Estrategia de testing base"), y crea el esquema con las migraciones, igual
 * que en desarrollo y en producción (D11). Al terminar, detiene los dos contenedores.
 */
export default async function setup(project: TestProject) {
  const [postgres, rabbitmq] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase(DATABASE)
      .withUsername(USER)
      .withPassword(PASSWORD)
      .withEnvironment({ TZ: 'America/Bogota' })
      .start(),
    // RabbitMQ no deja entrar al usuario por defecto (guest) desde fuera del contenedor.
    new RabbitMQContainer(RABBITMQ_IMAGE)
      .withEnvironment({
        RABBITMQ_DEFAULT_USER: USER,
        RABBITMQ_DEFAULT_PASS: PASSWORD,
      })
      .withStartupTimeout(120_000)
      .start(),
  ]);

  const env: IntegrationEnv = {
    DB_HOST: postgres.getHost(),
    DB_PORT: String(postgres.getPort()),
    DB_NAME: DATABASE,
    DB_USER: USER,
    DB_PASSWORD: PASSWORD,
    RABBITMQ_URL: `amqp://${USER}:${PASSWORD}@${rabbitmq.getHost()}:${rabbitmq.getMappedPort(AMQP_PORT)}`,
  };

  const dataSource = new DataSource(
    typeOrmOptions(validateEnv({ NODE_ENV: 'test', ...env })),
  );
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  project.provide('integrationEnv', env);
  project.provide(
    'rabbitmqManagementUrl',
    `http://${rabbitmq.getHost()}:${rabbitmq.getMappedPort(MANAGEMENT_PORT)}`,
  );

  return async () => {
    await Promise.all([postgres.stop(), rabbitmq.stop()]);
  };
}
