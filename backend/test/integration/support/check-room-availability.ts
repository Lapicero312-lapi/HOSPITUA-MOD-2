import type { Type } from '@nestjs/common';
import { integrationEnv } from './database.js';
import { FakeDailyListPublisherModule } from './fake-daily-list-publisher.js';

/**
 * Los módulos reales de Nest con los que una prueba de integración arma `check-room-availability`: la
 * configuración, PostgreSQL, el reloj, el cliente HTTP del Módulo 1, el publicador simulado de la lista del día (sin RabbitMQ) y el caso de uso (con
 * `consult-room-inventory`, `check-view-reservation` y `consult-maintenance-calendar`).
 *
 * Antes asigna el entorno de las pruebas de integración, porque `AppConfigModule` lo lee al importarse.
 * Devuelve la lista para `Test.createTestingModule({ imports })`, así que quien la usa puede agregar sus
 * proveedores o reemplazar alguno (por ejemplo, el Módulo 1 con `overrideProvider(MODULE1_PORT)`) antes de
 * compilar.
 */
export async function checkRoomAvailabilityModules(): Promise<Type[]> {
  Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
  const { AppConfigModule } =
    await import('../../../src/infrastructure/config/app-config.module.js');
  const { PersistenceModule } =
    await import('../../../src/infrastructure/out/persistence/persistence.module.js');
  const { ClockModule } =
    await import('../../../src/infrastructure/out/clock/clock.module.js');
  const { Module1ClientModule } =
    await import('../../../src/infrastructure/out/module1/module1-client.module.js');
  const { CheckRoomAvailabilityModule } =
    await import('../../../src/application/use-cases/check-room-availability/check-room-availability.module.js');
  return [
    AppConfigModule,
    PersistenceModule,
    ClockModule,
    Module1ClientModule,
    FakeDailyListPublisherModule,
    CheckRoomAvailabilityModule,
  ];
}
