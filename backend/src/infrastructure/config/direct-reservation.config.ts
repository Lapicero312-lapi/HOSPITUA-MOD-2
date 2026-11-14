import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ASSIGNMENT_MAX_RETRIES } from '../../application/use-cases/generate-direct-reservation/ports/in/create-direct-reservation.port.js';
import type { EnvironmentVariables } from './env.validation.js';

/**
 * Entrega `ASSIGNMENT_MAX_RETRIES` (plan de `generate-direct-reservation`, T001 y punto 14; por defecto `3`)
 * desde la configuración validada. Es global: `CreateDirectReservation` lo inyecta sin importarlo, como
 * `CLOSE_DAY_BATCH_SIZE` de `CloseDayConfigModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: ASSIGNMENT_MAX_RETRIES,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('ASSIGNMENT_MAX_RETRIES', { infer: true }),
    },
  ],
  exports: [ASSIGNMENT_MAX_RETRIES],
})
export class DirectReservationConfigModule {}
