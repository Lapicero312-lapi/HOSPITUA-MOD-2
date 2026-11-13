import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOta,
  anOtaReservation,
} from '../../../../support/builders.js';

/**
 * T037 de `check-view-reservation`: `/api/docs` documenta sus rutas como lo fija el plan ("OpenAPI (T037) y
 * pruebas de contrato (T034)"): las dos rutas con dos llamadores, sus parámetros, sus respuestas, sus
 * ejemplos y sus errores en orden. Con la aplicación completa y la base de Testcontainers, comprueba
 * también que lo documentado es lo que las rutas hacen: cada error documentado es el que la ruta responde, y
 * las respuestas reales traen los campos documentados. Sus reservas son de abril de 2035, que no usa
 * ninguna otra prueba.
 */

const LIST = '/api/reservations';
const DAY_SUMMARY = '/api/reservations/day-summary';
const DETAIL = '/api/reservations/{reservationRef}';
const STAY = { startDate: '2035-04-10', endDate: '2035-04-12' };

type Example = { summary: string; value: Record<string, unknown> };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example>;
};
type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
};
type Operation = {
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  responses: Record<string, { content: Record<string, MediaType> }>;
};
type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

describe('OpenAPI de las rutas de check-view-reservation (T037)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  let direct: Reservation;
  let ota: Reservation;

  const operation = (path: string) =>
    (document.paths[path] as Record<string, Operation>).get;
  const json = (path: string, status: string) =>
    operation(path).responses[status].content['application/json'];
  const schema = (name: string) =>
    document.components?.schemas?.[name] as Schema;
  const fields = (name: string) => Object.keys(schema(name).properties).sort();
  const required = (name: string) => [...(schema(name).required ?? [])].sort();
  const parameter = (path: string, name: string) => {
    const found = operation(path).parameters?.find(
      (candidate) => candidate.name === name,
    );
    if (found === undefined) {
      throw new Error(`${path} no documenta ${name}`);
    }
    return found;
  };
  const examples = (path: string, status: string) =>
    json(path, status).examples ?? {};
  const errorCodes = (path: string) => Object.keys(examples(path, '400'));
  const errorExample = (path: string, status: string, code: string) => {
    const example = examples(path, status)[code];
    if (example === undefined) {
      throw new Error(`${path} no documenta ${code} en ${status}`);
    }
    return example.value;
  };

  /** Un objeto real con los campos de su clase: ninguno de más y todos los obligatorios. */
  const expectShape = (value: unknown, name: string) => {
    const keys = Object.keys(value as object);
    expect(fields(name)).toEqual(expect.arrayContaining(keys));
    expect(keys).toEqual(expect.arrayContaining(required(name)));
  };

  const get = (
    path: string,
    client?: string,
    query: Record<string, string> = {},
  ) => {
    const call = request(app.getHttpServer()).get(path).query(query);
    return client === undefined ? call : call.set('X-Client', client);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = (await request(app.getHttpServer()).get('/api/docs-json'))
      .body as OpenAPIObject;

    const reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // La base de las e2e es compartida: una agencia propia, para no chocar con el nombre único.
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: `Agencia OpenAPI e2e ${randomUUID()}` }));
    direct = await reservations.insert(
      aDirectReservation({
        ...STAY,
        rooms: [aDirectRoom({ roomId: randomUUID() })],
      }),
    );
    ota = await reservations.insert(
      anOtaReservation(agency.id, { ...STAY, status: 'PENDING' }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('las respuestas de cada ruta', () => {
    it('el listado y el resumen del día declaran 200 y 400; el detalle, también la 404', () => {
      expect(Object.keys(operation(LIST).responses).sort()).toEqual([
        '200',
        '400',
      ]);
      expect(Object.keys(operation(DAY_SUMMARY).responses).sort()).toEqual([
        '200',
        '400',
      ]);
      expect(Object.keys(operation(DETAIL).responses).sort()).toEqual([
        '200',
        '400',
        '404',
      ]);
    });

    it.each([
      [LIST, ['RECEPTIONIST', 'MODULE1']],
      [DAY_SUMMARY, ['RECEPTIONIST']],
      [DETAIL, ['RECEPTIONIST', 'MODULE3']],
    ])(
      '%s: X-Client obligatoria, solo con los llamadores que admite',
      (path, clients) => {
        expect(parameter(path, 'X-Client')).toMatchObject({
          in: 'header',
          required: true,
          schema: { enum: clients },
        });
      },
    );
  });

  describe('una ruta, dos llamadores', () => {
    it('GET /api/reservations: la 200 es C1 o C5, con el ejemplo de cada llamador', () => {
      expect(json(LIST, '200').schema).toEqual({
        oneOf: [
          { $ref: '#/components/schemas/ReservationListDto' },
          { $ref: '#/components/schemas/StayRangeDto' },
        ],
      });
      expect(Object.keys(examples(LIST, '200'))).toEqual([
        'RECEPTIONIST',
        'MODULE1',
      ]);
      expect(operation(LIST).summary).toContain('`RECEPTIONIST`');
      expect(operation(LIST).summary).toContain('`MODULE1`');
    });

    it('GET /api/reservations/{reservationRef}: la 200 es C3 o C4, con el ejemplo de la Recepcionista y los dos del Módulo 3', () => {
      expect(json(DETAIL, '200').schema).toEqual({
        oneOf: [
          { $ref: '#/components/schemas/ReservationDetailDto' },
          { $ref: '#/components/schemas/ReservationBillingDto' },
        ],
      });
      expect(Object.keys(examples(DETAIL, '200'))).toEqual([
        'RECEPTIONIST',
        'MODULE3_DIRECT',
        'MODULE3_OTA',
      ]);
    });

    it('el resumen del día responde una sola forma', () => {
      expect(json(DAY_SUMMARY, '200').schema).toEqual({
        $ref: '#/components/schemas/DaySummaryDto',
      });
    });

    it('GET /api/reservations documenta los parámetros de C1 y roomId, ninguno obligatorio, cada uno con su llamador', () => {
      const names = (operation(LIST).parameters ?? [])
        .filter((candidate) => candidate.in === 'query')
        .map(({ name }) => name);
      expect(names).toEqual([
        'search',
        'status',
        'source',
        'otaId',
        'inConflict',
        'dateFrom',
        'dateTo',
        'order',
        'page',
        'roomId',
      ]);
      for (const name of names) {
        expect(parameter(LIST, name).required).toBe(false);
      }
      expect(parameter(LIST, 'roomId').description).toMatch(/^Módulo 1\./);
      expect(parameter(LIST, 'page').description).toMatch(/^Recepcionista\./);
      expect(parameter(LIST, 'dateFrom').description).toContain(
        'con el Módulo 1, obligatoria',
      );
      expect(parameter(LIST, 'dateTo').description).toContain(
        'con el Módulo 1, obligatoria',
      );
    });
  });

  describe('las clases de cada respuesta', () => {
    it('C1: la página y cada fila, con los campos del plan', () => {
      expect(fields('ReservationListDto')).toEqual([
        'items',
        'message',
        'page',
        'pageSize',
        'totalItems',
        'totalPages',
      ]);
      expect(required('ReservationListDto')).toEqual(
        fields('ReservationListDto'),
      );
      expect(fields('ReservationListItemDto')).toEqual([
        'actions',
        'conflict',
        'endDate',
        'externalConfirmationCode',
        'guest',
        'migrationStatus',
        'otaName',
        'reservationRef',
        'rooms',
        'source',
        'startDate',
        'status',
      ]);
      expect(fields('ReservationListGuestDto')).toEqual([
        'documentNumber',
        'fullName',
      ]);
      expect(fields('ReservationListRoomDto')).toEqual([
        'categoryRoom',
        'roomNumber',
      ]);
      expect(fields('ReservationListActionsDto')).toEqual([
        'canAssignRoom',
        'canCancel',
        'canModify',
      ]);
    });

    it('C2: la fecha y las dos cifras', () => {
      expect(fields('DaySummaryDto')).toEqual([
        'expectedArrivals',
        'expectedDepartures',
        'operationalDate',
      ]);
    });

    it('C4: los campos de la agencia no son obligatorios, porque solo vienen en reservas OTA, y el porcentaje es un número', () => {
      expect(fields('ReservationBillingDto')).toEqual([
        'channel',
        'otaCommissionPercentage',
        'otaConfirmationCode',
        'otaId',
        'quoteIds',
        'reservationRef',
      ]);
      expect(required('ReservationBillingDto')).toEqual([
        'channel',
        'quoteIds',
        'reservationRef',
      ]);
      expect(
        schema('ReservationBillingDto').properties.otaCommissionPercentage,
      ).toMatchObject({ type: 'number', minimum: 0, maximum: 100 });
    });

    it('C5: solo items, y cada reserva sin datos financieros ni del huésped', () => {
      expect(fields('StayRangeDto')).toEqual(['items']);
      expect(fields('StayRangeReservationDto')).toEqual([
        'endDate',
        'reservationRef',
        'rooms',
        'startDate',
        'status',
      ]);
      expect(schema('StayRangeReservationDto').properties.status).toMatchObject(
        { enum: ['PENDING', 'ACTIVE', 'IN_PROGRESS'] },
      );
      expect(fields('StayRangeRoomDto')).toEqual([
        'categoryRoom',
        'roomId',
        'roomNumber',
      ]);
    });
  });

  describe('los ejemplos del plan', () => {
    it('C1, C5, C2, C3 y C4 traen el ejemplo de su contrato', () => {
      expect(examples(LIST, '200').RECEPTIONIST.value).toMatchObject({
        items: [
          {
            reservationRef: 'RSV-3F9A1C7B',
            migrationStatus: 'AWAITING_CHECK_IN',
          },
        ],
        page: 1,
        pageSize: 10,
        totalItems: 45,
        totalPages: 5,
        message: null,
      });
      expect(examples(LIST, '200').MODULE1.value).toEqual({
        items: [
          {
            reservationRef: 'RSV-3F9A1C7B',
            status: 'ACTIVE',
            startDate: '2026-10-23',
            endDate: '2026-10-25',
            rooms: [
              {
                roomId: 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b',
                roomNumber: '204',
                categoryRoom: 'DOBLE',
              },
            ],
          },
        ],
      });
      expect(json(DAY_SUMMARY, '200').example).toEqual({
        operationalDate: '2026-10-09',
        expectedArrivals: 2,
        expectedDepartures: 0,
      });
      expect(examples(DETAIL, '200').RECEPTIONIST.value).toMatchObject({
        reservationRef: 'RSV-3F9A1C7B',
        nights: 2,
        guestCount: 3,
        updatedAt: '2026-10-08T15:42:10.123456-05:00',
      });
      expect(examples(DETAIL, '200').MODULE3_DIRECT.value).toEqual({
        reservationRef: 'RSV-3F9A1C7B',
        channel: 'DIRECT',
        quoteIds: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
      });
      expect(examples(DETAIL, '200').MODULE3_OTA.value).toEqual({
        reservationRef: 'RSV-8D02E5A4',
        channel: 'OTA',
        quoteIds: [],
        otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
        otaConfirmationCode: '4417829013',
        otaCommissionPercentage: 15,
      });
    });

    it('los ejemplos tienen la forma de su clase', () => {
      const list = examples(LIST, '200').RECEPTIONIST.value;
      expectShape(list, 'ReservationListDto');
      expectShape((list.items as object[])[0], 'ReservationListItemDto');
      const stayRange = examples(LIST, '200').MODULE1.value;
      expectShape(stayRange, 'StayRangeDto');
      expectShape((stayRange.items as object[])[0], 'StayRangeReservationDto');
      expectShape(json(DAY_SUMMARY, '200').example, 'DaySummaryDto');
      expectShape(
        examples(DETAIL, '200').RECEPTIONIST.value,
        'ReservationDetailDto',
      );
      expectShape(
        examples(DETAIL, '200').MODULE3_OTA.value,
        'ReservationBillingDto',
      );
    });
  });

  describe('los errores de cada ruta, en el orden en que se revisan', () => {
    it('GET /api/reservations: X-Client, los de C1, la referencia sin coincidencia, los del Módulo 1 y la excepción inesperada', () => {
      expect(errorCodes(LIST)).toEqual([
        'INVALID_CLIENT',
        'INVALID_RESERVATION_CODE',
        'INVALID_STATUS',
        'INVALID_CHANNEL',
        'INVALID_OTA_ID',
        'AGENCY_REQUIRES_OTA_CHANNEL',
        'INVALID_CONFLICT_FILTER',
        'INVALID_DATE',
        'INCOMPLETE_DATE_RANGE',
        'INVALID_DATE_RANGE',
        'DATE_RANGE_TOO_LARGE',
        'INVALID_SORT_ORDER',
        'INVALID_PAGE',
        'NAME_SEARCH_TOO_SHORT',
        'RESERVATION_NOT_FOUND',
        'UNSUPPORTED_PARAMETER',
        'INVALID_ROOM_ID',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('el resumen del día: X-Client y la excepción inesperada', () => {
      expect(errorCodes(DAY_SUMMARY)).toEqual([
        'INVALID_CLIENT',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('el detalle: la 400 con X-Client, el formato y la reserva de la Recepcionista; la 404, aparte, del Módulo 3', () => {
      expect(errorCodes(DETAIL)).toEqual([
        'INVALID_CLIENT',
        'INVALID_RESERVATION_CODE',
        'RESERVATION_NOT_FOUND',
        'REQUEST_NOT_PROCESSED',
      ]);
      expect(Object.keys(examples(DETAIL, '404'))).toEqual([
        'RESERVATION_NOT_FOUND',
      ]);
    });

    it('cada ejemplo de error tiene la forma del cuerpo de error y dice a qué llamador corresponde', () => {
      for (const [path, status] of [
        [LIST, '400'],
        [DAY_SUMMARY, '400'],
        [DETAIL, '400'],
        [DETAIL, '404'],
      ]) {
        for (const example of Object.values(examples(path, status))) {
          expectShape(example.value, 'ApiErrorBody');
        }
      }
      for (const [code, example] of Object.entries(examples(LIST, '400'))) {
        if (code !== 'INVALID_CLIENT') {
          expect(example.summary).toMatch(/^(Recepcionista|Módulo 1|Los dos):/);
        }
      }
    });
  });

  describe('lo documentado es lo que responden las rutas', () => {
    it('las respuestas reales traen los campos documentados', async () => {
      const list = await get(LIST, 'RECEPTIONIST', {
        search: direct.reservationRef,
      }).expect(200);
      expectShape(list.body, 'ReservationListDto');
      expectShape(list.body.items[0], 'ReservationListItemDto');
      expectShape(list.body.items[0].guest, 'ReservationListGuestDto');
      expectShape(list.body.items[0].rooms[0], 'ReservationListRoomDto');
      expectShape(list.body.items[0].actions, 'ReservationListActionsDto');

      const stayRange = await get(LIST, 'MODULE1', {
        dateFrom: STAY.startDate,
        dateTo: STAY.startDate,
        roomId: direct.rooms[0].roomId as string,
      }).expect(200);
      expectShape(stayRange.body, 'StayRangeDto');
      expectShape(stayRange.body.items[0], 'StayRangeReservationDto');
      expectShape(stayRange.body.items[0].rooms[0], 'StayRangeRoomDto');

      const summary = await get(DAY_SUMMARY, 'RECEPTIONIST').expect(200);
      expectShape(summary.body, 'DaySummaryDto');

      const detail = await get(
        `${LIST}/${direct.reservationRef}`,
        'RECEPTIONIST',
      ).expect(200);
      expectShape(detail.body, 'ReservationDetailDto');

      for (const reservation of [direct, ota]) {
        const billing = await get(
          `${LIST}/${reservation.reservationRef}`,
          'MODULE3',
        ).expect(200);
        expectShape(billing.body, 'ReservationBillingDto');
      }
    });

    const someAgency = randomUUID();
    it.each<[string, string | undefined, Record<string, string>]>([
      ['INVALID_CLIENT', undefined, {}],
      ['INVALID_RESERVATION_CODE', 'RECEPTIONIST', { search: 'a@b' }],
      ['INVALID_STATUS', 'RECEPTIONIST', { status: 'OTRO' }],
      ['INVALID_CHANNEL', 'RECEPTIONIST', { source: 'OTRO' }],
      ['INVALID_OTA_ID', 'RECEPTIONIST', { otaId: 'agencia' }],
      ['AGENCY_REQUIRES_OTA_CHANNEL', 'RECEPTIONIST', { otaId: someAgency }],
      ['INVALID_CONFLICT_FILTER', 'RECEPTIONIST', { inConflict: 'false' }],
      [
        'INVALID_DATE',
        'RECEPTIONIST',
        { dateFrom: '2035-02-30', dateTo: '2035-03-01' },
      ],
      ['INCOMPLETE_DATE_RANGE', 'RECEPTIONIST', { dateFrom: '2035-04-01' }],
      [
        'INVALID_DATE_RANGE',
        'RECEPTIONIST',
        { dateFrom: '2035-04-02', dateTo: '2035-04-01' },
      ],
      [
        'DATE_RANGE_TOO_LARGE',
        'RECEPTIONIST',
        { dateFrom: '2035-01-01', dateTo: '2036-01-02' },
      ],
      ['INVALID_SORT_ORDER', 'RECEPTIONIST', { order: 'arriba' }],
      ['INVALID_PAGE', 'RECEPTIONIST', { page: '0' }],
      ['NAME_SEARCH_TOO_SHORT', 'RECEPTIONIST', { search: 'ab' }],
      ['RESERVATION_NOT_FOUND', 'RECEPTIONIST', { search: 'RSV-FFFFFFFF' }],
      [
        'UNSUPPORTED_PARAMETER',
        'MODULE1',
        { dateFrom: '2035-04-01', dateTo: '2035-04-02', page: '1' },
      ],
      [
        'INVALID_ROOM_ID',
        'MODULE1',
        { dateFrom: '2035-04-01', dateTo: '2035-04-02', roomId: '204' },
      ],
    ])(
      'GET /api/reservations responde %s como su ejemplo',
      async (code, client, query) => {
        const res = await get(LIST, client, query).expect(400);

        const { errorCode, message, path } = res.body as Record<
          string,
          unknown
        >;
        expect({ errorCode, message, path }).toEqual({
          errorCode: code,
          message: errorExample(LIST, '400', code).message,
          path: errorExample(LIST, '400', code).path,
        });
      },
    );

    it('el resumen del día responde INVALID_CLIENT como su ejemplo', async () => {
      const res = await get(DAY_SUMMARY, 'MODULE1').expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'INVALID_CLIENT',
        message: errorExample(DAY_SUMMARY, '400', 'INVALID_CLIENT').message,
        path: errorExample(DAY_SUMMARY, '400', 'INVALID_CLIENT').path,
      });
    });

    it.each<[string, string, string, number, string | undefined]>([
      ['400', 'INVALID_CLIENT', 'RSV-3F9A1C7B', 400, 'MODULE1'],
      ['400', 'INVALID_RESERVATION_CODE', 'RSV-123', 400, 'RECEPTIONIST'],
      ['400', 'RESERVATION_NOT_FOUND', 'RSV-FFFFFFFF', 400, 'RECEPTIONIST'],
      ['404', 'RESERVATION_NOT_FOUND', 'RSV-FFFFFFFF', 404, 'MODULE3'],
    ])(
      'el detalle responde la %s %s como su ejemplo',
      async (status, code, reservationRef, httpStatus, client) => {
        const res = await get(`${LIST}/${reservationRef}`, client).expect(
          httpStatus,
        );

        expect(res.body).toMatchObject({
          errorCode: code,
          message: errorExample(DETAIL, status, code).message,
          path: errorExample(DETAIL, status, code).path,
        });
      },
    );
  });
});
