import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CheckViewReservationModule } from '../../../application/use-cases/check-view-reservation/check-view-reservation.module.js';
import { ConfigureOtaModule } from '../../../application/use-cases/configure-ota/configure-ota.module.js';
import { BookingFeedModule } from '../../../application/use-cases/generate-ota-reservation/booking-feed.module.js';
import { GenerateOtaReservationModule } from '../../../application/use-cases/generate-ota-reservation/generate-ota-reservation.module.js';
import { UpdateReservationModule } from '../../../application/use-cases/update-reservation/update-reservation.module.js';
import { AdvisoryLock } from './advisory-lock.js';
import { ChannexSetupJob } from './channex-setup.job.js';
import { ChannexSyncJob } from './channex-sync.job.js';
import { CloseDayJob } from './close-day.job.js';
import { DailyListJob } from './daily-list.job.js';

/**
 * Planificador de las tareas programadas (`@nestjs/schedule`), su bloqueo asesor y las tareas. Necesita
 * la conexión a PostgreSQL de `PersistenceModule`, que importa `AppModule`. La zona horaria de las tareas
 * es `JOBS_TIME_ZONE`.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CheckViewReservationModule,
    ConfigureOtaModule,
    GenerateOtaReservationModule,
    BookingFeedModule,
    UpdateReservationModule,
  ],
  providers: [
    AdvisoryLock,
    ChannexSetupJob,
    ChannexSyncJob,
    DailyListJob,
    CloseDayJob,
  ],
  exports: [AdvisoryLock],
})
export class JobsModule {}
