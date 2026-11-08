import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

/**
 * Cómo queda documentada C1 en OpenAPI (plan de calculate-dynamic-rate, T023; plan base, "Contratos
 * REST"): solo la respuesta 200 y la 400, con los campos y los ejemplos del plan, y la respuesta real con
 * exactamente esos campos y sus formas.
 */
describe('GET /api/rates/reference en OpenAPI (e2e, plan de calculate-dynamic-rate, T023)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  type Schema = { properties?: Record<string, { pattern?: string }> };
  type MoneyBody = { amount: string; currency: string };
  type RateBody = {
    categoryRoom: string;
    baseRate: MoneyBody;
    seasonAdjustmentPercentage: string;
    effectiveRate: MoneyBody;
  };

  const responses = (): Record<string, unknown> =>
    document.paths['/api/rates/reference']?.get?.responses ?? {};
  const schema = (name: string) =>
    (document.components?.schemas?.[name] ?? {}) as Schema;
  const fields = (name: string) =>
    Object.keys(schema(name).properties ?? {}).sort();
  /** La forma documentada de un campo; si no tiene, una expresión que nada cumple. */
  const pattern = (name: string, field: string) =>
    new RegExp(schema(name).properties?.[field]?.pattern ?? '(?!)');

  beforeAll(async () => {
    // La configuración del ejemplo de C1.
    app = await appWith({
      seasonAdjustmentPercentage: '15.00',
      currency: 'COP',
      baseRates: { DOBLE: '220000.00' },
    });
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    document = res.body as OpenAPIObject;
  });

  afterAll(async () => {
    await app.close();
  });

  it('declara solo la respuesta 200 y la 400', () => {
    expect(Object.keys(responses()).sort()).toEqual(['200', '400']);
  });

  it('la respuesta 200 trae items y note, con el ejemplo de C1', () => {
    expect(responses()['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ReferenceRatesDto' },
          example: {
            items: [
              {
                categoryRoom: 'DOBLE',
                baseRate: { amount: '220000.00', currency: 'COP' },
                seasonAdjustmentPercentage: '15.00',
                effectiveRate: { amount: '253000.00', currency: 'COP' },
              },
            ],
            note: NOTE,
          },
        },
      },
    });
    expect(document.components?.schemas?.ReferenceRatesDto).toEqual({
      type: 'object',
      properties: {
        items: {
          description:
            'Ordenadas por `categoryRoom`. Sin `RATE_REFERENCE`, `[]` con la misma `note`.',
          type: 'array',
          items: { $ref: '#/components/schemas/ReferenceRateDto' },
        },
        note: {
          type: 'string',
          description:
            'Siempre el mismo texto: la tarifa real sale de la cotización.',
          example: NOTE,
        },
      },
      required: ['items', 'note'],
    });
  });

  it('cada tarifa trae categoryRoom con su forma, baseRate, seasonAdjustmentPercentage con dos decimales y effectiveRate, y nada más: tampoco la capacidad', () => {
    expect(document.components?.schemas?.ReferenceRateDto).toEqual({
      type: 'object',
      properties: {
        categoryRoom: {
          type: 'string',
          pattern: '^[A-Z0-9_]{1,50}$',
          example: 'DOBLE',
        },
        baseRate: {
          description: 'La tarifa base de la categoría en `RATE_REFERENCE`.',
          allOf: [{ $ref: '#/components/schemas/MoneyDto' }],
        },
        seasonAdjustmentPercentage: {
          type: 'string',
          description:
            'El ajuste de temporada, el mismo para todas las categorías, con dos decimales: mayor que `-100` y hasta `100`, negativo en temporada baja.',
          pattern: '^-?\\d+\\.\\d{2}$',
          example: '15.00',
        },
        effectiveRate: {
          description:
            '`baseRate × (1 + seasonAdjustmentPercentage / 100)`, redondeada a dos decimales con `ROUND_HALF_UP`.',
          allOf: [{ $ref: '#/components/schemas/MoneyDto' }],
        },
      },
      required: [
        'categoryRoom',
        'baseRate',
        'seasonAdjustmentPercentage',
        'effectiveRate',
      ],
    });
  });

  it('el dinero trae amount como texto con dos decimales y currency de tres letras, y nada más', () => {
    expect(document.components?.schemas?.MoneyDto).toEqual({
      type: 'object',
      properties: {
        amount: {
          type: 'string',
          description: 'Como texto, con dos decimales.',
          pattern: '^\\d+\\.\\d{2}$',
          example: '220000.00',
        },
        currency: {
          type: 'string',
          description: 'Código ISO 4217.',
          pattern: '^[A-Z]{3}$',
          example: 'COP',
        },
      },
      required: ['amount', 'currency'],
    });
  });

  it('la respuesta 400 usa el cuerpo de error, solo con el ejemplo de REQUEST_NOT_PROCESSED', () => {
    const json = (
      responses()['400'] as {
        content: Record<
          string,
          { schema: unknown; examples: Record<string, { value: unknown }> }
        >;
      }
    ).content['application/json'];

    expect(json.schema).toEqual({
      $ref: '#/components/schemas/ApiErrorBody',
    });
    expect(Object.keys(json.examples)).toEqual(['REQUEST_NOT_PROCESSED']);
    // Literales del cuerpo de error.
    expect(json.examples.REQUEST_NOT_PROCESSED.value).toEqual({
      errorCode: 'REQUEST_NOT_PROCESSED',
      message: 'No fue posible procesar la solicitud.',
      timestamp: expect.any(String),
      path: '/api/rates/reference',
    });
  });

  it('con la configuración del ejemplo de C1, la ruta responde exactamente el ejemplo documentado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/rates/reference')
      .expect(200);
    const json = (
      responses()['200'] as { content: Record<string, { example: unknown }> }
    ).content['application/json'];

    expect(res.body).toEqual(json.example);
  });

  it('la respuesta real trae exactamente los campos documentados, con sus formas, también con un ajuste negativo y otra moneda', async () => {
    const other = await appWith({
      seasonAdjustmentPercentage: '-12.5',
      currency: 'USD',
      baseRates: { SUITE: '480000', DOBLE: '99.99' },
    });
    try {
      const res = await request(other.getHttpServer())
        .get('/api/rates/reference')
        .expect(200);
      const body = res.body as { items: RateBody[] };

      expect(Object.keys(body).sort()).toEqual(fields('ReferenceRatesDto'));
      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(fields('ReferenceRateDto'));
        expect(item.categoryRoom).toMatch(
          pattern('ReferenceRateDto', 'categoryRoom'),
        );
        expect(item.seasonAdjustmentPercentage).toMatch(
          pattern('ReferenceRateDto', 'seasonAdjustmentPercentage'),
        );
        for (const money of [item.baseRate, item.effectiveRate]) {
          expect(Object.keys(money).sort()).toEqual(fields('MoneyDto'));
          expect(money.amount).toMatch(pattern('MoneyDto', 'amount'));
          expect(money.currency).toMatch(pattern('MoneyDto', 'currency'));
        }
      }
    } finally {
      await other.close();
    }
  });
});
