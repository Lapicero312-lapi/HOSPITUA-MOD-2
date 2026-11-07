import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { MODULE3_PORT } from '../../../../../src/application/ports/out/module3.port.js';
import { CalculateDynamicRateModule } from '../../../../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CalculateDynamicRateService } from '../../../../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.service.js';
import {
  CALCULATE_DYNAMIC_RATE,
  QUOTE_CONCURRENCY,
} from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import {
  GET_REFERENCE_RATES,
  RATE_REFERENCE,
} from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';
import { GetReferenceRatesService } from '../../../../../src/application/use-cases/calculate-dynamic-rate/get-reference-rates.service.js';

/**
 * Lo que ponen `Module3ClientModule` y `RateReferenceConfigModule`, que son globales: el Módulo 3 no se llama
 * en esta prueba y la pantalla "Tarifas" queda sin configurar.
 */
@Global()
@Module({
  providers: [
    { provide: MODULE3_PORT, useValue: {} },
    { provide: QUOTE_CONCURRENCY, useValue: 2 },
    { provide: RATE_REFERENCE, useValue: null },
  ],
  exports: [MODULE3_PORT, QUOTE_CONCURRENCY, RATE_REFERENCE],
})
class FakeModule3ClientModule {}

const INJECTED_RATE = Symbol('INJECTED_RATE');

describe('CalculateDynamicRateModule (plan base, regla 4)', () => {
  it('exporta CALCULATE_DYNAMIC_RATE: otro módulo lo puede inyectar', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeModule3ClientModule, CalculateDynamicRateModule],
      // Un proveedor de fuera del módulo que lo inyecta, como un flujo de reserva: `moduleRef.get` lo
      // encontraría aunque el módulo no lo exportara; inyectarlo, no.
      providers: [
        {
          provide: INJECTED_RATE,
          inject: [CALCULATE_DYNAMIC_RATE],
          useFactory: (rate: unknown) => rate,
        },
      ],
    }).compile();

    expect(moduleRef.get(INJECTED_RATE)).toBeInstanceOf(
      CalculateDynamicRateService,
    );
    await moduleRef.close();
  });

  it('exporta GET_REFERENCE_RATES: el controlador de la pantalla "Tarifas" lo puede inyectar', async () => {
    const injected = Symbol('INJECTED_REFERENCE_RATES');
    const moduleRef = await Test.createTestingModule({
      imports: [FakeModule3ClientModule, CalculateDynamicRateModule],
      providers: [
        {
          provide: injected,
          inject: [GET_REFERENCE_RATES],
          useFactory: (referenceRates: unknown) => referenceRates,
        },
      ],
    }).compile();

    expect(moduleRef.get(injected)).toBeInstanceOf(GetReferenceRatesService);
    await moduleRef.close();
  });
});
