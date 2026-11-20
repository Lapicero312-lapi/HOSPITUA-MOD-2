import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer } from '@testcontainers/rabbitmq';
import { DataSource } from 'typeorm';
import type { TestProject } from 'vitest/node';
import { validateEnv } from '../../src/infrastructure/config/env.validation.js';
import {
  DAILY_LIST_QUEUE,
  DAILY_LIST_ROUTING_KEYS,
  EVENTS_EXCHANGE,
} from '../../src/infrastructure/config/rabbitmq.topology.js';
import { typeOrmOptions } from '../../src/infrastructure/config/typeorm.options.js';
import { MODULE1_DAILY_LIST_DLQ } from './support/module1-queue.js';

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
  /**
   * Vacía a propósito, como en las e2e (`test/e2e/support/integration-env.ts`): las variables del sistema
   * ganan sobre `backend/.env`, así ninguna prueba llama al Channex real con la clave de quien la corre, ni
   * la aplicación registra por su cuenta la agencia Booking.com mientras la prueba usa la base. Sin clave,
   * las tareas de Channex quedan apagadas (`configure-ota`, B0). La prueba que necesita Channex pone una
   * clave de prueba y lo simula.
   */
  CHANNEX_API_KEY: string;
};

declare module 'vitest' {
  export interface ProvidedContext {
    integrationEnv: IntegrationEnv;
    rabbitmqManagementUrl: string;
  }
}

/**
 * Declara `m1.reservas.diarias.queue` como lo hace el Módulo 1 (durable, con su dead-letter y unida a las dos
 * routing keys de la lista del día), por la API del panel de RabbitMQ. El Módulo 2 ya no la declara (plan
 * base, "Convenciones de colas"): así las pruebas corren como si el Módulo 1 ya estuviera conectado. Las que
 * prueban su ausencia la borran y la vuelven a crear (`support/module1-queue.ts`).
 */
async function declareModule1Queue(managementUrl: string): Promise<void> {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  const call = async (method: string, path: string, body: object) => {
    const response = await fetch(`${managementUrl}/api${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `RabbitMQ respondió ${response.status} a ${method} ${path}`,
      );
    }
  };
  const queue = encodeURIComponent(DAILY_LIST_QUEUE);
  await call('PUT', `/exchanges/%2F/${EVENTS_EXCHANGE}`, {
    type: 'topic',
    durable: true,
  });
  await call('PUT', `/queues/%2F/${MODULE1_DAILY_LIST_DLQ}`, { durable: true });
  await call('PUT', `/queues/%2F/${queue}`, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': MODULE1_DAILY_LIST_DLQ,
    },
  });
  for (const routingKey of Object.values(DAILY_LIST_ROUTING_KEYS)) {
    await call('POST', `/bindings/%2F/e/${EVENTS_EXCHANGE}/q/${queue}`, {
      routing_key: routingKey,
    });
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
    CHANNEX_API_KEY: '',
  };

  const dataSource = new DataSource(
    typeOrmOptions(validateEnv({ NODE_ENV: 'test', ...env })),
  );
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  const managementUrl = `http://${rabbitmq.getHost()}:${rabbitmq.getMappedPort(MANAGEMENT_PORT)}`;
  await declareModule1Queue(managementUrl);

  project.provide('integrationEnv', env);
  project.provide('rabbitmqManagementUrl', managementUrl);

  return async () => {
    await Promise.all([postgres.stop(), rabbitmq.stop()]);
  };
}
