import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdvisoryLock } from './advisory-lock.js';

/** Zona horaria de todas las tareas programadas (plan base, "Decisiones de stack"): `@Cron(..., { timeZone })`. */
export const JOBS_TIME_ZONE = 'America/Bogota';

/**
 * Planificador de las tareas programadas (`@nestjs/schedule`) y su bloqueo asesor. Necesita la conexión
 * a PostgreSQL de `PersistenceModule`: `AppModule` lo importa cuando exista la primera tarea programada.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [AdvisoryLock],
  exports: [AdvisoryLock],
})
export class JobsModule {}
