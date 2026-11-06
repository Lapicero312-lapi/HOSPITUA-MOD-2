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

/** Lo que pone `Module3ClientModule`, que es global: el Módulo 3 no se llama en esta prueba. */
@Global()
@Module({
  providers: [
    { provide: MODULE3_PORT, useValue: {} },
    { provide: QUOTE_CONCURRENCY, useValue: 2 },
  ],
  exports: [MODULE3_PORT, QUOTE_CONCURRENCY],
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
});
