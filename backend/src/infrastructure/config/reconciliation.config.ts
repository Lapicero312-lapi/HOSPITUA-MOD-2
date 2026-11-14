import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RECONCILIATION_MAX_ITEMS } from '../../application/use-cases/register-ota-information-commission/ports/in/reconcile-commissions.port.js';
import type { EnvironmentVariables } from './env.validation.js';

/**
 * Entrega `RECONCILIATION_MAX_ITEMS` (plan de `register-ota-information-commission`, "Configuración"; por
 * defecto `500`) desde la configuración validada. Es global: el controlador de la conciliación lo inyecta sin
 * importarlo, como `CLOSE_DAY_BATCH_SIZE` de `CloseDayConfigModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: RECONCILIATION_MAX_ITEMS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('RECONCILIATION_MAX_ITEMS', { infer: true }),
    },
  ],
  exports: [RECONCILIATION_MAX_ITEMS],
})
export class ReconciliationConfigModule {}
