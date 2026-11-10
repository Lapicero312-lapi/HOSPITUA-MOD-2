import { randomInt, randomUUID } from 'node:crypto';
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

/** Un documento propio de esta prueba, para no depender de lo que guarden otras. */
const DOCUMENT_NUMBER = `E2E${randomInt(1_000_000)}`;

/**
 * La aplicación completa (`AppModule`) con la base de Testcontainers: comprueba que `GET /api/guest-stays`
 * está conectada con su caso de uso y su consulta, y que los filtros inválidos salen por el filtro global
 * sin consultar. Cada filtro lo prueba la consulta contra PostgreSQL; los escenarios, la T018.
 */
describe('GET /api/guest-stays (e2e)', () => {
  let app: INestApplication<App>;
  let reservationRef: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    const reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(aDirectReservation());
    reservationRef = reservation.reservationRef;
    const guest = GuestData.restore({
      id: randomUUID(),
      reservationRef,
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: DOCUMENT_NUMBER,
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
    });
    await app.get<TransactionRunner>(TRANSACTION_RUNNER).run(async (tx) => {
      await app
        .get<GuestDataRepository>(GUEST_DATA_REPOSITORY)
        .insertMissing([guest], tx);
      await app
        .get<MigratoryMovementRepository>(MIGRATORY_MOVEMENT_REPOSITORY)
        .insertMissing(
          [
            MigratoryMovement.restore({
              id: randomUUID(),
              guestDataId: guest.id,
              movementType: 'ENTRY',
              movementDate: '2026-10-09',
            }),
          ],
          tx,
        );
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la forma de C1: John en el hotel, extranjero', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/guest-stays')
      .query({ search: DOCUMENT_NUMBER, nationality: 'FOREIGN' })
      .expect(200)
      .expect('Content-Type', /application\/json/);

    expect(res.body).toEqual({
      items: [
        {
          reservationRef,
          guest: {
            firstName: 'John',
            lastName: 'Smith',
            documentType: 'PAS',
            documentNumber: DOCUMENT_NUMBER,
            nationality: 'Estados Unidos',
            isForeign: true,
          },
          entryDate: '2026-10-09',
          exitDate: null,
          inHotel: true,
        },
      ],
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
      message: null,
    });
  });

  it('sin resultados responde 200 con la lista vacía y el mensaje', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/guest-stays')
      .query({ search: DOCUMENT_NUMBER, nationality: 'COLOMBIAN' })
      .expect(200);

    expect(res.body).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: 'No hay huéspedes que coincidan con los filtros.',
    });
  });

  it.each([
    [
      'una nacionalidad que no existe',
      'nationality=EXTRANJERO',
      'INVALID_NATIONALITY_FILTER',
    ],
    [
      'una situación que no existe',
      'presence=HOSPEDADO',
      'INVALID_PRESENCE_FILTER',
    ],
    ['una sola fecha', 'dateFrom=2026-10-01', 'INCOMPLETE_DATE_RANGE'],
    [
      'un rango invertido',
      'dateFrom=2026-10-31&dateTo=2026-10-01',
      'INVALID_DATE_RANGE',
    ],
    ['un nombre de 2 letras', 'search=al', 'NAME_SEARCH_TOO_SHORT'],
    ['la página 0', 'page=0', 'INVALID_PAGE'],
  ])('responde 400 con %s', async (_caso, query, errorCode) => {
    const res = await request(app.getHttpServer())
      .get(`/api/guest-stays?${query}`)
      .expect(400);

    expect(res.body).toMatchObject({ errorCode, path: '/api/guest-stays' });
    expect(res.body).toHaveProperty('message');
  });

  describe('C2: GET /api/reservations/{reservationRef}/guests/{documentNumber}', () => {
    it('responde 200 con la forma de C2: John con su enlace a la reserva y su entrada', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/reservations/${reservationRef}/guests/${DOCUMENT_NUMBER}`)
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(res.body).toEqual({
        reservationRef,
        reservationLink: `/api/reservations/${reservationRef}`,
        guest: {
          documentType: 'PAS',
          documentNumber: DOCUMENT_NUMBER,
          firstName: 'John',
          lastName: 'Smith',
          birthDate: '1990-05-12',
          nationality: 'Estados Unidos',
          isForeign: true,
          originPlace: 'Miami, Estados Unidos',
          destinationPlace: 'Cartagena, Colombia',
        },
        movements: [{ movementType: 'ENTRY', movementDate: '2026-10-09' }],
      });
    });

    it.each([
      [
        'un huésped que no está en la reserva',
        () => `/api/reservations/${reservationRef}/guests/NOEXISTE1`,
        'GUEST_NOT_FOUND',
      ],
      [
        'una reserva que no existe',
        () => `/api/reservations/RSV-00000000/guests/${DOCUMENT_NUMBER}`,
        'GUEST_NOT_FOUND',
      ],
      [
        'una referencia con otro formato',
        () => `/api/reservations/RSV-123/guests/${DOCUMENT_NUMBER}`,
        'INVALID_RESERVATION_CODE',
      ],
      [
        'un documento con caracteres no permitidos',
        () => `/api/reservations/${reservationRef}/guests/X99%3B`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'un documento en blanco',
        () => `/api/reservations/${reservationRef}/guests/%20`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'el documento vacío',
        () => `/api/reservations/${reservationRef}/guests/`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'sin documento',
        () => `/api/reservations/${reservationRef}/guests`,
        'INVALID_DOCUMENT_NUMBER',
      ],
      [
        'sin documento y con la referencia mala: primero la referencia',
        () => '/api/reservations/RSV-123/guests',
        'INVALID_RESERVATION_CODE',
      ],
    ])('responde 400 con %s', async (_caso, path, errorCode) => {
      const url = path();
      const res = await request(app.getHttpServer()).get(url).expect(400);

      expect(res.body).toMatchObject({ errorCode, path: url });
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  /**
   * T022 de `process-guest-data`: cómo quedan documentadas C1 y C2 en OpenAPI (plan base, "Contratos
   * REST"). Solo lectura, con la respuesta 200 y la 400; los parámetros, los campos y los ejemplos del plan;
   * cada ejemplo de error es lo que responde la ruta de verdad, y la respuesta real trae exactamente los
   * campos documentados. La ruta del detalle sin documento no se documenta.
   */
  describe('OpenAPI (T022 de process-guest-data)', () => {
    const C1 = '/api/guest-stays';
    const C2 = '/api/reservations/{reservationRef}/guests/{documentNumber}';

    type Schema = {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    type Json = {
      schema: unknown;
      example?: unknown;
      examples?: Record<string, { value: Record<string, unknown> }>;
    };
    type ErrorExample = { value: Record<string, unknown> };

    let document: OpenAPIObject;

    const operation = (path: string) => document.paths[path]?.get;
    const responses = (path: string) =>
      (operation(path)?.responses ?? {}) as Record<
        string,
        { content: Record<string, Json> }
      >;
    const json = (path: string, status: string) =>
      responses(path)[status].content['application/json'];
    const errorExample = (path: string, errorCode: string) =>
      (json(path, '400').examples ?? {})[errorCode] as ErrorExample;
    const schema = (name: string) =>
      (document.components?.schemas?.[name] ?? {}) as Schema;
    const property = (name: string, field: string) =>
      schema(name).properties?.[field] ?? {};
    const fields = (name: string) =>
      Object.keys(schema(name).properties ?? {}).sort();
    /** Los campos de `name` que pueden viajar `null`. */
    const nullable = (name: string) =>
      fields(name).filter((field) => property(name, field).nullable === true);
    /** La forma documentada de un campo; si no tiene, una expresión que nada cumple. */
    const pattern = (name: string, field: string) =>
      new RegExp((property(name, field).pattern as string) ?? '(?!)');

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      document = res.body as OpenAPIObject;
    });

    it('la ruta del detalle sin documento (…/guests) no se documenta', () => {
      expect(document.paths).not.toHaveProperty([
        '/api/reservations/{reservationRef}/guests',
      ]);
    });

    describe('C1: GET /api/guest-stays', () => {
      it('es solo lectura y declara solo la respuesta 200 y la 400', () => {
        expect(Object.keys(document.paths[C1] ?? {})).toEqual(['get']);
        expect(Object.keys(responses(C1)).sort()).toEqual(['200', '400']);
      });

      it('documenta sus seis parámetros en el orden de la tabla de C1, ninguno obligatorio, con sus valores y sus valores por defecto', () => {
        const description = expect.any(String);

        expect(operation(C1)?.parameters).toEqual([
          {
            name: 'nationality',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['ALL', 'FOREIGN', 'COLOMBIAN'],
              default: 'ALL',
            },
            description,
          },
          {
            name: 'presence',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['ALL', 'IN_HOTEL', 'CHECKED_OUT'],
              default: 'ALL',
            },
            description,
          },
          {
            name: 'dateFrom',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date' },
            description,
          },
          {
            name: 'dateTo',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date' },
            description,
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description,
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 1 },
            description,
          },
        ]);
      });

      it('la respuesta 200 es la página, con el ejemplo de C1', () => {
        expect(json(C1, '200')).toEqual({
          schema: { $ref: '#/components/schemas/GuestStayPageDto' },
          example: {
            items: [
              {
                reservationRef: 'RSV-3F9A1C7B',
                guest: {
                  firstName: 'John',
                  lastName: 'Smith',
                  documentType: 'PAS',
                  documentNumber: 'X99',
                  nationality: 'Estados Unidos',
                  isForeign: true,
                },
                entryDate: '2026-10-09',
                exitDate: null,
                inHotel: true,
              },
            ],
            page: 1,
            pageSize: 10,
            totalItems: 1,
            totalPages: 1,
            message: null,
          },
        });
      });

      it('la página, la fila y su huésped traen los campos de C1, todos obligatorios, y solo las fechas y el mensaje pueden ser null', () => {
        const page = [
          'items',
          'message',
          'page',
          'pageSize',
          'totalItems',
          'totalPages',
        ];
        const row = [
          'entryDate',
          'exitDate',
          'guest',
          'inHotel',
          'reservationRef',
        ];
        const guest = [
          'documentNumber',
          'documentType',
          'firstName',
          'isForeign',
          'lastName',
          'nationality',
        ];

        expect(fields('GuestStayPageDto')).toEqual(page);
        expect(schema('GuestStayPageDto').required?.sort()).toEqual(page);
        expect(fields('GuestStayDto')).toEqual(row);
        expect(schema('GuestStayDto').required?.sort()).toEqual(row);
        expect(fields('GuestStayGuestDto')).toEqual(guest);
        expect(schema('GuestStayGuestDto').required?.sort()).toEqual(guest);
        expect(nullable('GuestStayPageDto')).toEqual(['message']);
        expect(nullable('GuestStayDto')).toEqual(['entryDate', 'exitDate']);
        expect(nullable('GuestStayGuestDto')).toEqual([]);
      });

      it('las filas van en items, los números de la página son enteros, las fechas son AAAA-MM-DD y el tipo de documento es del enumerado', () => {
        expect(property('GuestStayPageDto', 'items')).toMatchObject({
          type: 'array',
          items: { $ref: '#/components/schemas/GuestStayDto' },
        });
        for (const field of ['page', 'pageSize', 'totalItems', 'totalPages']) {
          expect(property('GuestStayPageDto', field).type).toBe('integer');
        }
        expect(property('GuestStayDto', 'guest')).toEqual({
          $ref: '#/components/schemas/GuestStayGuestDto',
        });
        expect(property('GuestStayDto', 'reservationRef').pattern).toBe(
          '^RSV-[0-9A-F]{8}$',
        );
        for (const field of ['entryDate', 'exitDate']) {
          expect(property('GuestStayDto', field)).toMatchObject({
            type: 'string',
            format: 'date',
          });
        }
        expect(property('GuestStayGuestDto', 'documentType').enum).toEqual([
          'RC',
          'TI',
          'CC',
          'CE',
          'PAS',
          'NIT',
        ]);
      });

      it('la respuesta 400 usa el cuerpo de error, con un ejemplo por fila de la tabla de C1, en su orden, y el de REQUEST_NOT_PROCESSED', () => {
        expect(json(C1, '400').schema).toEqual({
          $ref: '#/components/schemas/ApiErrorBody',
        });
        expect(Object.keys(json(C1, '400').examples ?? {})).toEqual([
          'INVALID_NATIONALITY_FILTER',
          'INVALID_PRESENCE_FILTER',
          'INVALID_DATE',
          'INCOMPLETE_DATE_RANGE',
          'INVALID_DATE_RANGE',
          'DATE_RANGE_TOO_LARGE',
          'NAME_SEARCH_TOO_SHORT',
          'INVALID_SEARCH',
          'INVALID_PAGE',
          'REQUEST_NOT_PROCESSED',
        ]);
        // Literales del cuerpo de error.
        expect(errorExample(C1, 'REQUEST_NOT_PROCESSED').value).toEqual({
          errorCode: 'REQUEST_NOT_PROCESSED',
          message: 'No fue posible procesar la solicitud.',
          timestamp: expect.any(String),
          path: '/api/guest-stays',
        });
      });

      it.each([
        ['INVALID_NATIONALITY_FILTER', { nationality: 'OTRA' }],
        ['INVALID_PRESENCE_FILTER', { presence: 'OTRA' }],
        ['INVALID_DATE', { dateFrom: '2026-02-30', dateTo: '2026-03-01' }],
        ['INCOMPLETE_DATE_RANGE', { dateFrom: '2026-10-15' }],
        [
          'INVALID_DATE_RANGE',
          { dateFrom: '2026-10-17', dateTo: '2026-10-15' },
        ],
        [
          'DATE_RANGE_TOO_LARGE',
          { dateFrom: '2026-01-01', dateTo: '2027-01-02' },
        ],
        ['NAME_SEARCH_TOO_SHORT', { search: 'jo' }],
        ['INVALID_SEARCH', { search: 'smith;' }],
        ['INVALID_PAGE', { page: '0' }],
      ])(
        'el ejemplo de %s es lo que responde la ruta',
        async (errorCode, query) => {
          const res = await request(app.getHttpServer())
            .get(C1)
            .query(query)
            .expect(400);

          expect(res.body).toEqual({
            ...errorExample(C1, errorCode).value,
            timestamp: expect.any(String),
          });
        },
      );

      it('la respuesta real trae exactamente los campos documentados, con sus formas', async () => {
        const res = await request(app.getHttpServer())
          .get(C1)
          .query({ search: DOCUMENT_NUMBER })
          .expect(200);
        const [item] = res.body.items;

        expect(Object.keys(res.body).sort()).toEqual(
          fields('GuestStayPageDto'),
        );
        expect(Object.keys(item).sort()).toEqual(fields('GuestStayDto'));
        expect(Object.keys(item.guest).sort()).toEqual(
          fields('GuestStayGuestDto'),
        );
        expect(item.reservationRef).toMatch(
          pattern('GuestStayDto', 'reservationRef'),
        );
      });
    });

    describe('C2: GET /api/reservations/{reservationRef}/guests/{documentNumber}', () => {
      it('es solo lectura y declara solo la respuesta 200 y la 400', () => {
        expect(Object.keys(document.paths[C2] ?? {})).toEqual(['get']);
        expect(Object.keys(responses(C2)).sort()).toEqual(['200', '400']);
      });

      it('documenta la referencia, con su forma, y el documento, los dos obligatorios', () => {
        expect(operation(C2)?.parameters).toEqual([
          {
            name: 'reservationRef',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              pattern: '^RSV-[0-9A-F]{8}$',
              example: 'RSV-3F9A1C7B',
            },
          },
          {
            name: 'documentNumber',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'X99' },
            description: 'El documento del huésped.',
          },
        ]);
      });

      it('la respuesta 200 es el detalle, con el ejemplo de C2', () => {
        expect(json(C2, '200')).toEqual({
          schema: { $ref: '#/components/schemas/GuestStayDetailDto' },
          example: {
            reservationRef: 'RSV-3F9A1C7B',
            reservationLink: '/api/reservations/RSV-3F9A1C7B',
            guest: {
              documentType: 'PAS',
              documentNumber: 'X99',
              firstName: 'John',
              lastName: 'Smith',
              birthDate: '1990-05-12',
              nationality: 'Estados Unidos',
              isForeign: true,
              originPlace: 'Miami, Estados Unidos',
              destinationPlace: 'Cartagena, Colombia',
            },
            movements: [
              { movementType: 'ENTRY', movementDate: '2026-10-09' },
              { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
            ],
          },
        });
      });

      it('el detalle, su huésped y sus movimientos traen los campos de C2, todos obligatorios, y lo que puede llegar vacío puede ser null', () => {
        const detail = [
          'guest',
          'movements',
          'reservationLink',
          'reservationRef',
        ];
        const guest = [
          'birthDate',
          'destinationPlace',
          'documentNumber',
          'documentType',
          'firstName',
          'isForeign',
          'lastName',
          'nationality',
          'originPlace',
        ];
        const movement = ['movementDate', 'movementType'];

        expect(fields('GuestStayDetailDto')).toEqual(detail);
        expect(schema('GuestStayDetailDto').required?.sort()).toEqual(detail);
        expect(fields('GuestStayDetailGuestDto')).toEqual(guest);
        expect(schema('GuestStayDetailGuestDto').required?.sort()).toEqual(
          guest,
        );
        expect(fields('GuestMovementDto')).toEqual(movement);
        expect(schema('GuestMovementDto').required?.sort()).toEqual(movement);
        expect(nullable('GuestStayDetailDto')).toEqual([]);
        expect(nullable('GuestStayDetailGuestDto')).toEqual([
          'destinationPlace',
          'firstName',
          'lastName',
          'nationality',
          'originPlace',
        ]);
        expect(nullable('GuestMovementDto')).toEqual([]);
      });

      it('los movimientos van en movements, con su tipo del enumerado y su fecha AAAA-MM-DD, y la fecha de nacimiento también es AAAA-MM-DD', () => {
        expect(property('GuestStayDetailDto', 'movements')).toMatchObject({
          type: 'array',
          items: { $ref: '#/components/schemas/GuestMovementDto' },
        });
        expect(property('GuestStayDetailDto', 'guest')).toEqual({
          $ref: '#/components/schemas/GuestStayDetailGuestDto',
        });
        expect(property('GuestMovementDto', 'movementType').enum).toEqual([
          'ENTRY',
          'DEPARTURE',
        ]);
        for (const [name, field] of [
          ['GuestMovementDto', 'movementDate'],
          ['GuestStayDetailGuestDto', 'birthDate'],
        ]) {
          expect(property(name, field)).toMatchObject({
            type: 'string',
            format: 'date',
          });
        }
      });

      it('la respuesta 400 usa el cuerpo de error, con los errores de C2 y el de REQUEST_NOT_PROCESSED', () => {
        expect(json(C2, '400').schema).toEqual({
          $ref: '#/components/schemas/ApiErrorBody',
        });
        expect(Object.keys(json(C2, '400').examples ?? {})).toEqual([
          'GUEST_NOT_FOUND',
          'INVALID_RESERVATION_CODE',
          'INVALID_DOCUMENT_NUMBER',
          'REQUEST_NOT_PROCESSED',
        ]);
        // Literales del cuerpo de error.
        expect(errorExample(C2, 'REQUEST_NOT_PROCESSED').value).toEqual({
          errorCode: 'REQUEST_NOT_PROCESSED',
          message: 'No fue posible procesar la solicitud.',
          timestamp: expect.any(String),
          path: expect.stringMatching(/^\/api\/reservations\/.+\/guests\/.+$/),
        });
      });

      it.each([
        'GUEST_NOT_FOUND',
        'INVALID_RESERVATION_CODE',
        'INVALID_DOCUMENT_NUMBER',
      ])(
        'el ejemplo de %s es lo que responde la ruta de ese ejemplo',
        async (errorCode) => {
          const example = errorExample(C2, errorCode).value;

          const res = await request(app.getHttpServer())
            .get(example.path as string)
            .expect(400);

          expect(res.body).toEqual({
            ...example,
            timestamp: expect.any(String),
          });
        },
      );

      it('la respuesta real trae exactamente los campos documentados, con sus formas', async () => {
        const res = await request(app.getHttpServer())
          .get(`/api/reservations/${reservationRef}/guests/${DOCUMENT_NUMBER}`)
          .expect(200);

        expect(Object.keys(res.body).sort()).toEqual(
          fields('GuestStayDetailDto'),
        );
        expect(Object.keys(res.body.guest).sort()).toEqual(
          fields('GuestStayDetailGuestDto'),
        );
        expect(res.body.movements).toHaveLength(1);
        expect(Object.keys(res.body.movements[0]).sort()).toEqual(
          fields('GuestMovementDto'),
        );
        expect(res.body.reservationRef).toMatch(
          pattern('GuestStayDetailDto', 'reservationRef'),
        );
      });
    });
  });
});
