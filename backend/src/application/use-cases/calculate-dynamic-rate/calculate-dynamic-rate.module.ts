import { Module } from '@nestjs/common';
import { CalculateDynamicRateService } from './calculate-dynamic-rate.service.js';
import { CALCULATE_DYNAMIC_RATE } from './ports/in/calculate-dynamic-rate.port.js';

/**
 * Los servicios de `calculate-dynamic-rate` (plan base, regla 4 de la arquitectura). Usa `MODULE3_PORT` y
 * `QUOTE_CONCURRENCY` de `Module3ClientModule`, que es global.
 */
@Module({
  providers: [
    { provide: CALCULATE_DYNAMIC_RATE, useClass: CalculateDynamicRateService },
  ],
  exports: [CALCULATE_DYNAMIC_RATE],
})
export class CalculateDynamicRateModule {}
