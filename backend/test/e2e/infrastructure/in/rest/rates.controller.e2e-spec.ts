import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODULE3_PORT,
  type Module3Port,
} from '../../../../../src/application/ports/out/module3.port.js';
import {
  RATE_REFERENCE,
  type RateReferenceSettings,
} from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';

const NOTE = 'Referencia ilustrativa. La tarifa real se obtiene al cotizar.';

/** El Módulo 3 simulado: la pantalla "Tarifas" nunca lo llama (FR-009). */
const module3 = { createQuote: vi.fn() };

/** La aplicación completa con la configuración `RATE_REFERENCE` que se pida. */
async function appWith(
  settings: RateReferenceSettings | null,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RATE_REFERENCE)
    .useValue(settings)
    .overrideProvider(MODULE3_PORT)
    .useValue(module3 as unknown as Module3Port)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('GET /api/rates/reference (e2e, plan de calculate-dynamic-rate, C1)', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    module3.createQuote.mockClear();
  });

  it('responde 200 con el ejemplo de C1, ordenado por categoría, con la nota y sin llamar al Módulo 3', async () => {
    app = await appWith({
      seasonAdjustmentPercentage: '15.00',
      currency: 'COP',
      baseRates: { SUITE: '480000.00', DOBLE: '220000.00' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/rates/reference')
      .expect(200);

    expect(res.body).toEqual({
      items: [
        {
          categoryRoom: 'DOBLE',
          baseRate: { amount: '220000.00', currency: 'COP' },
          seasonAdjustmentPercentage: '15.00',
          effectiveRate: { amount: '253000.00', currency: 'COP' },
        },
        {
          categoryRoom: 'SUITE',
          baseRate: { amount: '480000.00', currency: 'COP' },
          seasonAdjustmentPercentage: '15.00',
          effectiveRate: { amount: '552000.00', currency: 'COP' },
        },
      ],
      note: NOTE,
    });
    expect(module3.createQuote).not.toHaveBeenCalled();
  });

  it('sin RATE_REFERENCE, responde 200 sin tarifas y con la misma nota', async () => {
    app = await appWith(null);

    const res = await request(app.getHttpServer())
      .get('/api/rates/reference')
      .expect(200);

    expect(res.body).toEqual({ items: [], note: NOTE });
  });

  it('los importes y el porcentaje salen siempre con dos decimales', async () => {
    app = await appWith({
      seasonAdjustmentPercentage: '10',
      currency: 'COP',
      baseRates: { DOBLE: '220000' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/rates/reference')
      .expect(200);

    expect(res.body.items).toEqual([
      {
        categoryRoom: 'DOBLE',
        baseRate: { amount: '220000.00', currency: 'COP' },
        seasonAdjustmentPercentage: '10.00',
        effectiveRate: { amount: '242000.00', currency: 'COP' },
      },
    ]);
  });
});
