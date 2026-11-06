import { Module } from '@nestjs/common';
import { CalculateDynamicRateService } from './calculate-dynamic-rate.service.js';
import { GetReferenceRatesService } from './get-reference-rates.service.js';
import { CALCULATE_DYNAMIC_RATE } from './ports/in/calculate-dynamic-rate.port.js';
import { GET_REFERENCE_RATES } from './ports/in/get-reference-rates.port.js';

/**
 * Los servicios de `calculate-dynamic-rate` (plan base, regla 4 de la arquitectura). Usa `MODULE3_PORT` y
 * `QUOTE_CONCURRENCY` de `Module3ClientModule` y `RATE_REFERENCE` de `RateReferenceConfigModule`, que son
 * globales.
 */
@Module({
  providers: [
    { provide: CALCULATE_DYNAMIC_RATE, useClass: CalculateDynamicRateService },
    { provide: GET_REFERENCE_RATES, useClass: GetReferenceRatesService },
  ],
  exports: [CALCULATE_DYNAMIC_RATE, GET_REFERENCE_RATES],
})
export class CalculateDynamicRateModule {}
