import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigureOtaModule } from '../../../application/use-cases/configure-ota/configure-ota.module.js';
import { GenerateOtaReservationModule } from '../../../application/use-cases/generate-ota-reservation/generate-ota-reservation.module.js';
import { AdvisoryLock } from './advisory-lock.js';
import { ChannexSetupJob } from './channex-setup.job.js';
import { ChannexSyncJob } from './channex-sync.job.js';

/** Zona horaria de todas las tareas programadas (plan base, "Decisiones de stack"): `@Cron(..., { timeZone })`. */
export const JOBS_TIME_ZONE = 'America/Bogota';

/**
 * Planificador de las tareas programadas (`@nestjs/schedule`), su bloqueo asesor y las tareas. Necesita
 * la conexión a PostgreSQL de `PersistenceModule`, que importa `AppModule`.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigureOtaModule,
    GenerateOtaReservationModule,
  ],
  providers: [AdvisoryLock, ChannexSetupJob, ChannexSyncJob],
  exports: [AdvisoryLock],
})
export class JobsModule {}
