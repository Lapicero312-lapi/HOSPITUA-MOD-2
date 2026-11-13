import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GUEST_DATA_REPOSITORY,
  type GuestDataRepository,
} from '../../../../../src/application/ports/out/guest-data.repository.js';
import {
  MIGRATORY_MOVEMENT_REPOSITORY,
  type MigratoryMovementRepository,
} from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { GuestData } from '../../../../../src/domain/migration/guest-data.js';
import { MigratoryMovement } from '../../../../../src/domain/migration/migratory-movement.js';
import { aDirectReservation } from '../../../../support/builders.js';

/**
 * T018 de `export-sire-file`: la documentación OpenAPI de A, B y C (`/api/docs-json`), contra los contratos
 * y la tabla D del plan. Además de la forma del documento, comprueba que dice lo que la ruta hace: cada
 * ejemplo de error documentado es el que la ruta responde, y las respuestas reales traen exactamente los
 * campos documentados. Usa periodos de 2033, que no usa ninguna otra prueba e2e.
 */

const EXPORTS = '/api/sire/exports';
const MOVEMENTS = '/api/sire/movements';
const PREVIEW = '/api/sire/movements/{movementId}/preview';

/** El movimiento de los ejemplos del documento: no existe en la base. */
const EXAMPLE_MOVEMENT_ID = '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b';

/** Las líneas del ejemplo de A del plan, con el tabulador y el CRLF por defecto. */
const PLAN_FILE =
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990\r\n' +
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tS\t12/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990\r\n';

type Example = { summary: string; value: Record<string, unknown> };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example>;
};
type Response = {
  headers?: Record<string, { schema?: Record<string, unknown> }>;
  content: Record<string, MediaType>;
};
type Operation = {
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<string, Response>;
};
type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

describe('OpenAPI de "Exportar archivo SIRE" (T018)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  let johnEntryId: string;
  let martaEntryId: string;

  const operation = (path: string, method: 'get' | 'post') =>
    (document.paths[path] as Record<string, Operation>)[method];
  const json = (path: string, method: 'get' | 'post', status: string) =>
    operation(path, method).responses[status].content['application/json'];
  const schema = (name: string) =>
    document.components?.schemas?.[name] as Schema;
  const fields = (name: string) => Object.keys(schema(name).properties).sort();
  const errorCodes = (path: string, method: 'get' | 'post') =>
    Object.keys(json(path, method, '400').examples ?? {});
  const errorExample = (path: string, method: 'get' | 'post', code: string) => {
    const example = json(path, method, '400').examples?.[code];
    if (example === undefined) {
      throw new Error(`${method} ${path} no documenta ${code}`);
    }
    return example.value;
  };

  const exportAs = (user: string | null, body: object) => {
    const call = request(app.getHttpServer()).post(EXPORTS);
    return (user === null ? call : call.set('X-User', user)).send(body);
  };
  const list = (query: Record<string, string>) =>
    request(app.getHttpServer()).get(MOVEMENTS).query(query);
  const preview = (movementId: string) =>
    request(app.getHttpServer()).get(
      `/api/sire/movements/${movementId}/preview`,
    );
  const newUser = () => `recepcion-${randomUUID()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = (await request(app.getHttpServer()).get('/api/docs-json'))
      .body as OpenAPIObject;

    // Febrero de 2033: John, extranjero, y Ana, colombiana. Abril de 2033: Marta, con el separador en un
    // dato, así que su línea no se puede escribir.
    const reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation());
    const guest = (
      documentNumber: string,
      nationality: string,
      originPlace: string | null,
    ) =>
      GuestData.restore({
        id: randomUUID(),
        reservationRef: reservation.reservationRef,
        firstName: 'Nombre',
        lastName: 'Apellido',
        documentType: 'PAS',
        documentNumber,
        birthDate: '1990-05-12',
        nationality,
        originPlace,
        destinationPlace: null,
      });
    const john = guest('OAPI-JOHN', 'Estados Unidos', 'Miami, Estados Unidos');
    const ana = guest('OAPI-ANA', 'Colombia', null);
    const marta = guest('OAPI-MARTA', 'Polonia', 'Varsovia,\tPolonia');
    const movement = (
      of: GuestData,
      movementType: 'ENTRY' | 'DEPARTURE',
      movementDate: string,
    ) =>
      MigratoryMovement.restore({
        id: randomUUID(),
        guestDataId: of.id,
        movementType,
        movementDate,
      });
    const movements = [
      movement(john, 'ENTRY', '2033-02-05'),
      movement(john, 'DEPARTURE', '2033-02-08'),
      movement(ana, 'ENTRY', '2033-02-05'),
      movement(marta, 'ENTRY', '2033-04-05'),
    ];
    johnEntryId = movements[0].id;
    martaEntryId = movements[3].id;
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (tx) => {
      await app
        .get<GuestDataRepository>(GUEST_DATA_REPOSITORY)
        .insertMissing([john, ana, marta], tx);
      await app
        .get<MigratoryMovementRepository>(MIGRATORY_MOVEMENT_REPOSITORY)
        .insertMissing(movements, tx);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('cada ruta declara solo sus respuestas: A con 200, 400 y 429; B y C con 200 y 400', () => {
    expect(Object.keys(operation(EXPORTS, 'post').responses).sort()).toEqual([
      '200',
      '400',
      '429',
    ]);
    expect(Object.keys(operation(MOVEMENTS, 'get').responses).sort()).toEqual([
      '200',
      '400',
    ]);
    expect(Object.keys(operation(PREVIEW, 'get').responses).sort()).toEqual([
      '200',
      '400',
    ]);
  });

  describe('A, POST /api/sire/exports', () => {
    it('pide la cabecera X-User', () => {
      expect(operation(EXPORTS, 'post').parameters).toEqual([
        expect.objectContaining({
          name: 'X-User',
          in: 'header',
          required: true,
        }),
      ]);
    });

    it('el cuerpo es SireExportRequestDto, con las dos solicitudes del plan como ejemplos', () => {
      const body = operation(EXPORTS, 'post').requestBody;

      expect(body?.required).toBe(true);
      const media = body?.content['application/json'];
      expect(media?.schema).toEqual({
        $ref: '#/components/schemas/SireExportRequestDto',
      });
      expect(media?.examples?.PERIOD.value).toEqual({
        exportKind: 'PERIOD',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      });
      expect(media?.examples?.SINGLE_MOVEMENT.value).toEqual({
        exportKind: 'SINGLE_MOVEMENT',
        movementId: EXAMPLE_MOVEMENT_ID,
      });
      expect(fields('SireExportRequestDto')).toEqual([
        'endDate',
        'exportKind',
        'movementId',
        'startDate',
      ]);
      // Solo `exportKind` es siempre obligatorio: las fechas son de PERIOD y el movimiento, de SINGLE_MOVEMENT.
      expect(schema('SireExportRequestDto').required).toEqual(['exportKind']);
      expect(
        schema('SireExportRequestDto').properties.exportKind,
      ).toMatchObject({ enum: ['PERIOD', 'SINGLE_MOVEMENT'] });
    });

    it('la respuesta 200 es únicamente el archivo en texto, con el ejemplo del plan y sus cabeceras', () => {
      const ok = operation(EXPORTS, 'post').responses['200'];

      expect(Object.keys(ok.content)).toEqual(['text/plain']);
      expect(ok.content['text/plain']).toEqual({
        schema: { type: 'string' },
        example: PLAN_FILE,
      });
      expect(Object.keys(ok.headers ?? {})).toEqual([
        'Export-Id',
        'Content-Disposition',
        'Access-Control-Expose-Headers',
      ]);
      expect(ok.headers?.['Export-Id'].schema).toEqual({
        type: 'string',
        format: 'uuid',
      });
    });

    it('los errores 400 son los de la tabla D para A, y la 429 trae Retry-After', () => {
      expect(json(EXPORTS, 'post', '400').schema).toEqual({
        $ref: '#/components/schemas/ApiErrorBody',
      });
      expect(errorCodes(EXPORTS, 'post')).toEqual([
        'USER_REQUIRED',
        'INVALID_USER',
        'INVALID_EXPORT_KIND',
        'INCOMPLETE_DATE_RANGE',
        'INVALID_DATE',
        'INVALID_DATE_RANGE',
        'PERIOD_TOO_LARGE',
        'MOVEMENT_NOT_FOUND',
        'NO_MIGRATORY_MOVEMENTS',
        'INVALID_GUEST_CHARACTERS',
        'REQUEST_NOT_PROCESSED',
      ]);
      const tooMany = operation(EXPORTS, 'post').responses['429'];
      expect(tooMany.headers?.['Retry-After'].schema).toEqual({
        type: 'integer',
        minimum: 1,
      });
      expect(
        tooMany.content['application/json'].examples?.TOO_MANY_REQUESTS.value,
      ).toEqual({
        errorCode: 'TOO_MANY_REQUESTS',
        message:
          'Se superó el límite de solicitudes de exportación. Intente de nuevo en unos segundos.',
        timestamp: expect.any(String) as string,
        path: EXPORTS,
      });
    });
  });

  describe('B, GET /api/sire/movements', () => {
    it('startDate y endDate son obligatorias y page es opcional, desde 1', () => {
      expect(
        operation(MOVEMENTS, 'get').parameters?.map(
          ({ name, in: where, required, schema: of }) => ({
            name,
            where,
            required,
            of,
          }),
        ),
      ).toEqual([
        {
          name: 'startDate',
          where: 'query',
          required: true,
          of: { type: 'string', format: 'date' },
        },
        {
          name: 'endDate',
          where: 'query',
          required: true,
          of: { type: 'string', format: 'date' },
        },
        {
          name: 'page',
          where: 'query',
          required: false,
          of: { type: 'integer', minimum: 1, default: 1 },
        },
      ]);
    });

    it('la respuesta 200 es SireMovementPageDto, con los campos de B, y el error 400 trae los códigos de la tabla D para B', () => {
      expect(json(MOVEMENTS, 'get', '200').schema).toEqual({
        $ref: '#/components/schemas/SireMovementPageDto',
      });
      expect(fields('SireMovementPageDto')).toEqual([
        'items',
        'message',
        'page',
        'pageSize',
        'totalItems',
        'totalPages',
      ]);
      expect(fields('SireMovementItemDto')).toEqual([
        'guest',
        'movementDate',
        'movementId',
        'movementType',
        'reservationRef',
      ]);
      expect(fields('SireMovementGuestDto')).toEqual([
        'documentNumber',
        'documentType',
        'fullName',
        'nationality',
      ]);
      expect(errorCodes(MOVEMENTS, 'get')).toEqual([
        'INCOMPLETE_DATE_RANGE',
        'INVALID_DATE',
        'INVALID_DATE_RANGE',
        'PERIOD_TOO_LARGE',
        'INVALID_PAGE',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('un periodo sin extranjeros responde exactamente el ejemplo documentado', async () => {
      const res = await list({
        startDate: '2033-06-01',
        endDate: '2033-06-30',
      }).expect(200);

      expect(res.body).toEqual(
        json(MOVEMENTS, 'get', '200').examples?.WITHOUT_FOREIGNERS.value,
      );
    });

    it('la respuesta real trae exactamente los campos documentados', async () => {
      const res = await list({
        startDate: '2033-02-01',
        endDate: '2033-02-28',
      }).expect(200);
      const body = res.body as {
        items: { guest: object }[];
      };

      expect(Object.keys(body).sort()).toEqual(fields('SireMovementPageDto'));
      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(fields('SireMovementItemDto'));
        expect(Object.keys(item.guest).sort()).toEqual(
          fields('SireMovementGuestDto'),
        );
      }
    });
  });

  describe('C, GET /api/sire/movements/{movementId}/preview', () => {
    it('movementId es un UUID; la respuesta 200 es SireMovementPreviewDto con el ejemplo del plan; el error 400 trae los códigos de C', () => {
      expect(operation(PREVIEW, 'get').parameters).toEqual([
        expect.objectContaining({
          name: 'movementId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        }),
      ]);
      const ok = json(PREVIEW, 'get', '200');
      expect(ok.schema).toEqual({
        $ref: '#/components/schemas/SireMovementPreviewDto',
      });
      expect(ok.example).toMatchObject({
        movementId: EXAMPLE_MOVEMENT_ID,
        reservationRef: 'RSV-3F9A1C7B',
        line: PLAN_FILE.split('\r\n')[0],
      });
      expect((ok.example as { fields: unknown[] }).fields).toHaveLength(12);
      expect(fields('SireMovementPreviewDto')).toEqual([
        'fields',
        'line',
        'movementId',
        'reservationRef',
      ]);
      expect(fields('SireFieldDto')).toEqual(['name', 'position', 'value']);
      expect(errorCodes(PREVIEW, 'get')).toEqual([
        'MOVEMENT_NOT_FOUND',
        'INVALID_GUEST_CHARACTERS',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('la respuesta real trae exactamente los campos documentados', async () => {
      const res = await preview(johnEntryId).expect(200);
      const body = res.body as { fields: object[] };

      expect(Object.keys(body).sort()).toEqual(
        fields('SireMovementPreviewDto'),
      );
      expect(body.fields).toHaveLength(12);
      for (const field of body.fields) {
        expect(Object.keys(field).sort()).toEqual(fields('SireFieldDto'));
      }
    });
  });

  describe('cada error documentado es el que la ruta responde', () => {
    /** Lo que se compara: el código, el mensaje y la ruta, sin la hora. */
    const comparable = (body: Record<string, unknown>) => ({
      errorCode: body.errorCode,
      message: body.message,
      path: body.path,
    });

    it.each([
      ['USER_REQUIRED', () => exportAs(null, { exportKind: 'PERIOD' })],
      [
        'INVALID_USER',
        () => exportAs('x'.repeat(101), { exportKind: 'PERIOD' }),
      ],
      [
        'INVALID_EXPORT_KIND',
        () => exportAs(newUser(), { exportKind: 'MONTHLY' }),
      ],
      [
        'INCOMPLETE_DATE_RANGE',
        () =>
          exportAs(newUser(), {
            exportKind: 'PERIOD',
            startDate: '2033-02-01',
          }),
      ],
      [
        'INVALID_DATE',
        () =>
          exportAs(newUser(), {
            exportKind: 'PERIOD',
            startDate: '2033-02-30',
            endDate: '2033-03-31',
          }),
      ],
      [
        'INVALID_DATE_RANGE',
        () =>
          exportAs(newUser(), {
            exportKind: 'PERIOD',
            startDate: '2033-02-28',
            endDate: '2033-02-01',
          }),
      ],
      [
        'PERIOD_TOO_LARGE',
        () =>
          exportAs(newUser(), {
            exportKind: 'PERIOD',
            startDate: '2033-01-01',
            endDate: '2034-01-02',
          }),
      ],
      [
        'MOVEMENT_NOT_FOUND',
        () =>
          exportAs(newUser(), {
            exportKind: 'SINGLE_MOVEMENT',
            movementId: EXAMPLE_MOVEMENT_ID,
          }),
      ],
      [
        'NO_MIGRATORY_MOVEMENTS',
        () =>
          exportAs(newUser(), {
            exportKind: 'PERIOD',
            startDate: '2033-06-01',
            endDate: '2033-06-30',
          }),
      ],
      [
        'INVALID_GUEST_CHARACTERS',
        () =>
          exportAs(newUser(), {
            exportKind: 'PERIOD',
            startDate: '2033-04-01',
            endDate: '2033-04-30',
          }),
      ],
    ])('A: %s', async (code, send) => {
      const res = await send().expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(EXPORTS, 'post', code)),
      );
    });

    it('A: la 429 responde el ejemplo documentado, con Retry-After', async () => {
      const user = newUser();
      for (let attempt = 0; attempt < 10; attempt++) {
        await exportAs(user, { exportKind: 'MONTHLY' }).expect(400);
      }

      const res = await exportAs(user, { exportKind: 'MONTHLY' }).expect(429);

      expect(res.headers['retry-after']).toMatch(/^[1-9]\d*$/);
      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(
          json(EXPORTS, 'post', '429').examples?.TOO_MANY_REQUESTS
            .value as Record<string, unknown>,
        ),
      );
    });

    it.each([
      ['INCOMPLETE_DATE_RANGE', { startDate: '2033-02-01' }],
      ['INVALID_DATE', { startDate: '2033-02-30', endDate: '2033-03-31' }],
      [
        'INVALID_DATE_RANGE',
        { startDate: '2033-02-28', endDate: '2033-02-01' },
      ],
      ['PERIOD_TOO_LARGE', { startDate: '2033-01-01', endDate: '2034-01-02' }],
      [
        'INVALID_PAGE',
        { startDate: '2033-02-01', endDate: '2033-02-28', page: '0' },
      ],
    ])('B: %s', async (code, query) => {
      const res = await list(query).expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(MOVEMENTS, 'get', code)),
      );
    });

    it('C: MOVEMENT_NOT_FOUND, con la ruta del ejemplo', async () => {
      const res = await preview(EXAMPLE_MOVEMENT_ID).expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(PREVIEW, 'get', 'MOVEMENT_NOT_FOUND')),
      );
    });

    it('C: INVALID_GUEST_CHARACTERS', async () => {
      const res = await preview(martaEntryId).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'INVALID_GUEST_CHARACTERS',
        message: errorExample(PREVIEW, 'get', 'INVALID_GUEST_CHARACTERS')
          .message,
        path: `/api/sire/movements/${martaEntryId}/preview`,
      });
    });
  });
});
