import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';

/**
 * T021 de `register-ota-information-commission`: la documentación OpenAPI (`/api/docs-json`) de A1, A2 y A3,
 * contra el punto 3 de C del plan. Además de la forma del documento, comprueba que dice lo que las rutas
 * hacen: cada ejemplo de error documentado es el que la ruta responde.
 */

const A1 = '/api/ota-commissions';
const A2 = '/api/ota-commissions/reconciliations';
const A3_LIST = '/api/otas';
const A3_DETAIL = '/api/otas/{otaId}';

type Example = { summary: string; value: Record<string, unknown> };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example>;
};
type Operation = {
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<string, { content: Record<string, MediaType> }>;
};
type Schema = { properties: Record<string, Record<string, unknown>> };

describe('OpenAPI de "Registrar confirmación y comisión de OTA" (T021)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  const operation = (path: string, method: 'get' | 'post') =>
    (document.paths[path] as Record<string, Operation>)[method];
  const json = (path: string, method: 'get' | 'post', status: string) =>
    operation(path, method).responses[status].content['application/json'];
  const errorCodes = (path: string, method: 'get' | 'post') =>
    Object.keys(json(path, method, '400').examples ?? {});
  const errorExample = (path: string, method: 'get' | 'post', code: string) => {
    const example = json(path, method, '400').examples?.[code];
    if (example === undefined) {
      throw new Error(`${path} no documenta ${code}`);
    }
    return example.value;
  };
  const fields = (name: string) =>
    Object.keys(
      (document.components?.schemas?.[name] as Schema).properties,
    ).sort();
  /** Lo que se compara de un error: el código, el mensaje y la ruta, sin la hora. */
  const comparable = (body: Record<string, unknown>) => ({
    errorCode: body.errorCode,
    message: body.message,
    path: body.path,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = (await request(app.getHttpServer()).get('/api/docs-json'))
      .body as OpenAPIObject;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('A1, GET /api/ota-commissions', () => {
    it('los parámetros de la tabla de A1, en su orden, con las fechas obligatorias', () => {
      expect(
        operation(A1, 'get').parameters?.map(({ name, required }) => [
          name,
          required,
        ]),
      ).toEqual([
        ['dateFrom', true],
        ['dateTo', true],
        ['commissionStatus', false],
        ['reservationStatus', false],
        ['otaId', false],
        ['page', false],
      ]);
    });

    it('la 200 es OtaCommissionPageDto con el ejemplo del plan: importes como texto y el porcentaje como número', () => {
      const ok = json(A1, 'get', '200');

      expect(ok.schema).toEqual({
        $ref: '#/components/schemas/OtaCommissionPageDto',
      });
      expect(ok.example).toMatchObject({
        items: [
          {
            reservationRef: 'RSV-8D02E5A4',
            grossAmount: { amount: '400.00', currency: 'USD' },
            commissionPercentage: 15,
            commissionAmount: { amount: '60.00', currency: 'USD' },
            commissionStatus: 'CALCULATED',
          },
        ],
        pageSize: 100,
      });
      expect(fields('OtaCommissionDto')).toEqual([
        'commissionAmount',
        'commissionPercentage',
        'commissionStatus',
        'endDate',
        'externalConfirmationCode',
        'grossAmount',
        'otaId',
        'otaName',
        'reservationRef',
        'startDate',
        'status',
      ]);
    });

    it('la 400: un ejemplo por código, en el orden de readOtaCommissionQuery, y REQUEST_NOT_PROCESSED', () => {
      expect(errorCodes(A1, 'get')).toEqual([
        'INCOMPLETE_DATE_RANGE',
        'INVALID_DATE',
        'INVALID_DATE_RANGE',
        'DATE_RANGE_TOO_LARGE',
        'INVALID_COMMISSION_STATUS',
        'INVALID_STATUS',
        'OTA_NOT_FOUND',
        'INVALID_PAGE',
        'REQUEST_NOT_PROCESSED',
      ]);
    });
  });

  describe('A2, POST /api/ota-commissions/reconciliations', () => {
    it('el cuerpo es ReconciliationRequestDto, con el ejemplo del plan', () => {
      const media = operation(A2, 'post').requestBody?.content[
        'application/json'
      ];

      expect(media?.schema).toEqual({
        $ref: '#/components/schemas/ReconciliationRequestDto',
      });
      expect(media?.examples?.PLAN.value).toEqual({
        action: 'RECONCILED',
        items: [
          {
            reservationRef: 'RSV-8D02E5A4',
            grossAmount: '400.00',
            commissionAmount: '60.00',
          },
        ],
      });
    });

    it('la 200 es ReconciliationOutcomeDto, con el ejemplo de resultados por ítem del plan', () => {
      const ok = json(A2, 'post', '200');

      expect(ok.schema).toEqual({
        $ref: '#/components/schemas/ReconciliationOutcomeDto',
      });
      expect(ok.example).toMatchObject({
        results: [
          { result: 'APPLIED', commissionStatus: 'RECONCILED', reason: null },
          {
            result: 'REJECTED',
            commissionStatus: 'CALCULATED',
            reason: 'AMOUNT_MISMATCH',
          },
        ],
        summary: { applied: 1, alreadyApplied: 0, rejected: 1 },
      });
      expect(fields('ReconciliationResultDto')).toEqual([
        'commissionStatus',
        'reason',
        'reservationRef',
        'result',
      ]);
    });

    it('la 400: un ejemplo por código, en el orden de readReconciliationRequest, y REQUEST_NOT_PROCESSED', () => {
      expect(errorCodes(A2, 'post')).toEqual([
        'INVALID_RECONCILIATION_REQUEST',
        'INVALID_RECONCILIATION_ACTION',
        'INVALID_RESERVATION_CODE',
        'INVALID_AMOUNT',
        'REQUEST_NOT_PROCESSED',
      ]);
    });
  });

  describe('A3, GET /api/otas y GET /api/otas/{otaId}', () => {
    it('las dos rutas responden OtaDto con los campos de A3; el detalle documenta su 400 OTA_NOT_FOUND', () => {
      expect(json(A3_LIST, 'get', '200').schema).toEqual({
        $ref: '#/components/schemas/OtaListDto',
      });
      expect(json(A3_DETAIL, 'get', '200').schema).toEqual({
        $ref: '#/components/schemas/OtaDto',
      });
      expect(fields('OtaDto')).toEqual([
        'activeReservations',
        'commissionPercentage',
        'connectionStatus',
        'id',
        'lastSyncAt',
        'linkedAt',
        'name',
      ]);
      expect(errorCodes(A3_DETAIL, 'get')).toEqual(['OTA_NOT_FOUND']);
    });
  });

  describe('cada error documentado es el que la ruta responde', () => {
    const DATES = { dateFrom: '2036-03-01', dateTo: '2036-03-31' };

    it.each([
      ['INCOMPLETE_DATE_RANGE', { dateFrom: '2036-03-01' }],
      ['INVALID_DATE', { dateFrom: '2036-02-30', dateTo: '2036-03-31' }],
      ['INVALID_DATE_RANGE', { dateFrom: '2036-03-31', dateTo: '2036-03-01' }],
      [
        'DATE_RANGE_TOO_LARGE',
        { dateFrom: '2036-01-01', dateTo: '2037-01-03' },
      ],
      ['INVALID_COMMISSION_STATUS', { ...DATES, commissionStatus: 'PENDING' }],
      ['INVALID_STATUS', { ...DATES, reservationStatus: 'BORRADA' }],
      ['OTA_NOT_FOUND', { ...DATES, otaId: 'abc' }],
      ['INVALID_PAGE', { ...DATES, page: '0' }],
    ])('A1: %s', async (code, query) => {
      const res = await request(app.getHttpServer())
        .get(A1)
        .query(query)
        .expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(A1, 'get', code)),
      );
    });

    const ITEM = {
      reservationRef: 'RSV-8D02E5A4',
      grossAmount: '400.00',
      commissionAmount: '60.00',
    };

    it.each([
      ['INVALID_RECONCILIATION_REQUEST', { action: 'PAID', items: [] }],
      ['INVALID_RECONCILIATION_ACTION', { action: 'BORRAR', items: [ITEM] }],
      [
        'INVALID_RESERVATION_CODE',
        { action: 'PAID', items: [{ ...ITEM, reservationRef: 'rsv-1' }] },
      ],
      [
        'INVALID_AMOUNT',
        { action: 'PAID', items: [{ ...ITEM, grossAmount: '-1.00' }] },
      ],
    ])('A2: %s', async (code, body) => {
      const res = await request(app.getHttpServer())
        .post(A2)
        .send(body)
        .expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(A2, 'post', code)),
      );
    });

    it('A3: OTA_NOT_FOUND con el mensaje documentado (la ruta real lleva el id)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/otas/abc')
        .expect(400);
      const documented = errorExample(A3_DETAIL, 'get', 'OTA_NOT_FOUND');

      expect(res.body).toMatchObject({
        errorCode: documented.errorCode,
        message: documented.message,
      });
    });
  });
});
