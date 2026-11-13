import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateQuote } from '../../../../../src/application/integration/rate-quote.js';
import {
  CLOCK,
  type Clock,
} from '../../../../../src/application/ports/out/clock.js';
import {
  MODULE1_PORT,
  type Module1Port,
  Module1UnavailableError,
} from '../../../../../src/application/ports/out/module1.port.js';
import {
  MODULE3_PORT,
  type Module3Port,
  Module3UnavailableError,
} from '../../../../../src/application/ports/out/module3.port.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/**
 * T017 de `generate-direct-reservation`: la documentación OpenAPI de A y B (`/api/docs-json`), contra los
 * contratos A y B, la tabla C y el punto 13 del plan. Además de la forma del documento, comprueba que dice lo
 * que las rutas hacen: cada ejemplo de error documentado es el que la ruta responde, y las respuestas reales
 * traen los campos documentados. Usa un día operativo y estadías de 2034, que no usa ninguna otra prueba.
 */

const PREVIEW = '/api/reservations/direct/preview';
const CREATION = '/api/reservations/direct';

const TODAY = '2034-02-01';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2034-02-01T15:00:00.000Z'),
};

/** La estadía de los errores y la de la reserva que sí se crea, para que no se crucen en la 201 ni la 202. */
const STAY = { startDate: '2034-02-10', endDate: '2034-02-13' };
const CREATED_STAY = { startDate: '2034-03-10', endDate: '2034-03-13' };

/** Cómo responde el Módulo 1 simulado en cada prueba. */
let inventoryDown = false;
let maintenanceDown = false;
let room202InMaintenance = false;
const module1: Partial<Module1Port> = {
  listRoomsByCategory: () =>
    inventoryDown
      ? Promise.reject(new Module1UnavailableError('tiempo agotado'))
      : Promise.resolve([ROOM_202, ROOM_201]),
  getMaintenances: (roomId, startDate, endDate) => {
    if (maintenanceDown) {
      return Promise.reject(new Module1UnavailableError('tiempo agotado'));
    }
    return Promise.resolve(
      room202InMaintenance && roomId === ROOM_202.id
        ? {
            roomId,
            available: false,
            conflicts: [
              { maintenanceStart: startDate, maintenanceEnd: endDate },
            ],
          }
        : { roomId, available: true, conflicts: [] },
    );
  },
};

/** Cómo responde el Módulo 3 simulado: 750000.00 por habitación, sin responder o en dos monedas. */
let pricingDown = false;
let mixedCurrencies = false;
let quotes = 0;
const createQuote: Module3Port['createQuote'] = () => {
  quotes += 1;
  if (pricingDown) {
    return Promise.reject(new Module3UnavailableError('tiempo agotado'));
  }
  const currency = mixedCurrencies && quotes % 2 === 0 ? 'USD' : 'COP';
  return Promise.resolve({
    quoteId: `q-openapi-${quotes}`,
    currency,
    nightlyRates: [],
    lodgingAmount: Money.of('750000.00', currency),
  } satisfies RateQuote);
};

const GUEST = {
  firstName: 'Valentina',
  lastName: 'Ospina',
  documentType: 'CC',
  documentNumber: '1144093552',
  nationality: 'Colombia',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'valentina@correo.com',
};

/** El cuerpo de A en `STAY`. */
const previewBody = (changes: object = {}) => ({
  ...STAY,
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
  ...changes,
});

/** El cuerpo de B en `STAY`. */
const creationBody = (changes: object = {}) => ({
  ...previewBody(),
  guest: GUEST,
  notes: 'Llegada después de las 8 p. m.',
  expectedRates: [
    { position: 1, lodgingAmount: '750000.00', currency: 'COP' },
    { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
  ],
  ...changes,
});

type Example = { summary: string; value: Record<string, unknown> };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example>;
};
type Operation = {
  parameters?: { name: string; in: string }[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<
    string,
    {
      headers?: Record<string, { schema?: Record<string, unknown> }>;
      content: Record<string, MediaType>;
    }
  >;
};
type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

describe('OpenAPI de la reserva directa (T017 de generate-direct-reservation)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  const operation = (path: string) =>
    (document.paths[path] as Record<string, Operation>).post;
  const json = (path: string, status: string) =>
    operation(path).responses[status].content['application/json'];
  const schema = (name: string) =>
    document.components?.schemas?.[name] as Schema;
  const fields = (name: string) => Object.keys(schema(name).properties).sort();
  const errorCodes = (path: string) =>
    Object.keys(json(path, '400').examples ?? {});
  const errorExample = (path: string, code: string) => {
    const example = json(path, '400').examples?.[code];
    if (example === undefined) {
      throw new Error(`${path} no documenta ${code}`);
    }
    return example.value;
  };

  /** Un objeto real con los campos de su clase: ninguno de más y todos los obligatorios. */
  const expectShape = (value: unknown, name: string) => {
    const keys = Object.keys(value as object);
    expect(fields(name)).toEqual(expect.arrayContaining(keys));
    expect(keys).toEqual(expect.arrayContaining(schema(name).required ?? []));
  };

  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      // Una clave nueva por solicitud: la creación la exige (punto 15, T019); la vista previa no la lee.
      .set('Idempotency-Key', randomUUID())
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(MODULE1_PORT)
      .useValue(module1)
      .overrideProvider(MODULE3_PORT)
      .useValue({ createQuote })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = (await request(app.getHttpServer()).get('/api/docs-json'))
      .body as OpenAPIObject;
  });

  beforeEach(() => {
    inventoryDown = false;
    maintenanceDown = false;
    room202InMaintenance = false;
    pricingDown = false;
    mixedCurrencies = false;
  });

  afterAll(async () => {
    await app.close();
  });

  it('A declara solo 200 y 400, y B solo 201 y 400', () => {
    expect(Object.keys(operation(PREVIEW).responses).sort()).toEqual([
      '200',
      '400',
    ]);
    expect(Object.keys(operation(CREATION).responses).sort()).toEqual([
      '201',
      '400',
    ]);
  });

  describe('A, POST /api/reservations/direct/preview', () => {
    it('el cuerpo es DirectReservationPreviewRequestDto, con el ejemplo del plan', () => {
      const body = operation(PREVIEW).requestBody;

      expect(body?.required).toBe(true);
      const media = body?.content['application/json'];
      expect(media?.schema).toEqual({
        $ref: '#/components/schemas/DirectReservationPreviewRequestDto',
      });
      expect(media?.examples?.PLAN.value).toEqual({
        startDate: '2026-10-12',
        endDate: '2026-10-15',
        categoryRoom: 'DOBLE',
        rooms: [{ guestCount: 2 }, { guestCount: 2 }],
      });
      expect(fields('DirectReservationPreviewRequestDto')).toEqual([
        'categoryRoom',
        'endDate',
        'rooms',
        'startDate',
      ]);
      expect(schema('DirectReservationPreviewRequestDto').required).toEqual([
        'startDate',
        'endDate',
        'categoryRoom',
        'rooms',
      ]);
      expect(fields('RequestedRoomDto')).toEqual(['guestCount', 'roomId']);
      expect(schema('RequestedRoomDto').required).toEqual(['guestCount']);
    });

    it('la respuesta 200 es DirectReservationPreviewDto, con los DTO compartidos y el ejemplo del plan', () => {
      const ok = json(PREVIEW, '200');

      expect(ok.schema).toEqual({
        $ref: '#/components/schemas/DirectReservationPreviewDto',
      });
      expect(ok.example).toMatchObject({
        availability: { categoryRoom: 'DOBLE', availableCount: 2 },
        quotes: { total: { amount: '1500000.00', currency: 'COP' } },
        reservation: { guestCount: 4 },
      });
      expect(fields('DirectReservationPreviewDto')).toEqual([
        'assignedRooms',
        'availability',
        'quotes',
        'reservation',
      ]);
      expect(fields('AvailabilityDto')).toEqual([
        'availableCount',
        'categoryRoom',
        'endDate',
        'rooms',
        'startDate',
      ]);
      expect(fields('AvailabilityRoomDto')).toEqual([
        'available',
        'maintenance',
        'message',
        'reason',
        'roomId',
        'roomNumber',
      ]);
      expect(fields('AssignedRoomDto')).toEqual([
        'guestCount',
        'maxCapacity',
        'position',
        'roomId',
        'roomNumber',
      ]);
      expect(fields('QuotesDto')).toEqual(['rooms', 'total']);
      // La vista previa siempre trae el total.
      expect(schema('QuotesDto').required).toEqual(['rooms', 'total']);
      expect(fields('RoomQuoteDto')).toEqual([
        'categoryRoom',
        'key',
        'lodgingAmount',
        'nightlyRates',
        'nights',
      ]);
      expect(fields('NightlyRateDto')).toEqual(['date', 'rate']);
    });

    it('los errores 400 son los que A puede responder, en el orden en que se revisan (punto 13)', () => {
      expect(json(PREVIEW, '400').schema).toEqual({
        $ref: '#/components/schemas/ApiErrorBody',
      });
      expect(errorCodes(PREVIEW)).toEqual([
        'INVALID_CATEGORY',
        'INVALID_ROOM_ID',
        'INVALID_ROOM_COUNT',
        'ROOM_ALREADY_IN_RESERVATION',
        'GUEST_COUNT_TOO_LOW',
        'INVALID_GUEST_COUNT',
        'INVALID_RESERVATION_DATES',
        'START_DATE_IN_PAST',
        'INVENTORY_UNAVAILABLE',
        'MAINTENANCE_CHECK_UNAVAILABLE',
        'ROOM_NOT_AVAILABLE',
        'NO_AVAILABILITY',
        'GUEST_COUNT_EXCEEDS_CAPACITY',
        'PRICING_UNAVAILABLE',
        'CURRENCY_MISMATCH',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('la respuesta real trae los campos documentados', async () => {
      const res = await post(PREVIEW, previewBody()).expect(200);
      const body = res.body as {
        availability: { rooms: object[] };
        assignedRooms: object[];
        quotes: { rooms: object[] };
        reservation: object;
      };

      expectShape(body, 'DirectReservationPreviewDto');
      expectShape(body.availability, 'AvailabilityDto');
      expectShape(body.availability.rooms[0], 'AvailabilityRoomDto');
      expectShape(body.assignedRooms[0], 'AssignedRoomDto');
      expectShape(body.quotes, 'QuotesDto');
      expectShape(body.quotes.rooms[0], 'RoomQuoteDto');
      expectShape(body.reservation, 'PreviewReservationDto');
    });
  });

  describe('B, POST /api/reservations/direct', () => {
    it('el cuerpo es DirectReservationCreationRequestDto, con el ejemplo del plan', () => {
      const media =
        operation(CREATION).requestBody?.content['application/json'];

      expect(media?.schema).toEqual({
        $ref: '#/components/schemas/DirectReservationCreationRequestDto',
      });
      expect(media?.examples?.PLAN.value).toMatchObject({
        guest: GUEST,
        notes: 'Llegada después de las 8 p. m.',
        expectedRates: [
          { position: 1, lodgingAmount: '750000.00', currency: 'COP' },
          { position: 2, lodgingAmount: '750000.00', currency: 'COP' },
        ],
      });
      expect(fields('DirectReservationCreationRequestDto')).toEqual([
        'categoryRoom',
        'endDate',
        'expectedRates',
        'guest',
        'notes',
        'rooms',
        'startDate',
      ]);
      expect(
        [
          ...(schema('DirectReservationCreationRequestDto').required ?? []),
        ].sort(),
      ).toEqual([
        'categoryRoom',
        'endDate',
        'expectedRates',
        'guest',
        'rooms',
        'startDate',
      ]);
      expect(schema('DirectReservationGuestDto').required).toEqual([
        'firstName',
        'lastName',
        'documentType',
        'documentNumber',
        'nationality',
      ]);
      expect(
        schema('DirectReservationGuestDto').properties.documentType,
      ).toMatchObject({ enum: ['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'] });
      expect(fields('ExpectedRateDto')).toEqual([
        'currency',
        'lodgingAmount',
        'position',
      ]);
    });

    it('la respuesta 201 es el detalle de C3 (ReservationDetailDto), con Location y el ejemplo', () => {
      const created = operation(CREATION).responses['201'];

      expect(created.content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/ReservationDetailDto',
      });
      expect(created.headers?.Location.schema).toEqual({ type: 'string' });
      expect(created.content['application/json'].example).toMatchObject({
        reservationRef: 'RSV-3F9A1C7B',
        status: 'ACTIVE',
        source: 'DIRECT',
        nights: 3,
        guestCount: 4,
        cancellation: null,
      });
      expect(fields('ReservationDetailDto')).toEqual([
        'cancellation',
        'conflict',
        'createdAt',
        'endDate',
        'externalConfirmationCode',
        'guest',
        'guestCount',
        'nights',
        'notes',
        'otaName',
        'reservationRef',
        'rooms',
        'source',
        'startDate',
        'status',
        'updatedAt',
      ]);
    });

    it('los errores 400 son los que B puede responder, en el orden en que se revisan (punto 13)', () => {
      expect(errorCodes(CREATION)).toEqual([
        'INVALID_CATEGORY',
        'INVALID_ROOM_ID',
        'RATE_CHANGED',
        'INVALID_ROOM_COUNT',
        'ROOM_ALREADY_IN_RESERVATION',
        'GUEST_COUNT_TOO_LOW',
        'INVALID_GUEST_COUNT',
        'INVALID_RESERVATION_DATES',
        'START_DATE_IN_PAST',
        'NOTES_TOO_LONG',
        'GUEST_DATA_REQUIRED',
        'INVALID_DOCUMENT_TYPE',
        'INVALID_CHARACTERS',
        'INVALID_EMAIL',
        'INVENTORY_UNAVAILABLE',
        'MAINTENANCE_CHECK_UNAVAILABLE',
        'ROOM_NOT_AVAILABLE',
        'NO_AVAILABILITY',
        'GUEST_COUNT_EXCEEDS_CAPACITY',
        'PRICING_UNAVAILABLE',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('lo que todavía no existe no se documenta: ni la Idempotency-Key (T019) ni AVAILABILITY_TAKEN (T009)', () => {
      expect(operation(CREATION).parameters ?? []).toEqual([]);
      expect(errorCodes(CREATION)).not.toContain('IDEMPOTENCY_KEY_REQUIRED');
      expect(errorCodes(CREATION)).not.toContain('IDEMPOTENCY_KEY_REUSED');
      expect(errorCodes(CREATION)).not.toContain('AVAILABILITY_TAKEN');
    });

    it('la respuesta real trae los campos documentados y la cabecera Location', async () => {
      const res = await post(
        CREATION,
        creationBody({ ...CREATED_STAY }),
      ).expect(201);
      const body = res.body as {
        reservationRef: string;
        rooms: object[];
        guest: object;
      };

      expect(res.headers.location).toBe(
        `/api/reservations/${body.reservationRef}`,
      );
      expectShape(body, 'ReservationDetailDto');
      expectShape(body.rooms[0], 'ReservationDetailRoomDto');
      expectShape(body.guest, 'ReservationDetailGuestDto');
    });
  });

  describe('cada error documentado es el que la ruta responde', () => {
    /** Lo que se compara: el código, el mensaje y la ruta, sin la hora. */
    const comparable = (body: Record<string, unknown>) => ({
      errorCode: body.errorCode,
      message: body.message,
      path: body.path,
    });

    /** Los errores que A y B responden igual, con el cambio que los provoca. */
    const common: [string, object, () => void][] = [
      ['INVALID_CATEGORY', { categoryRoom: 'doble' }, () => undefined],
      [
        'INVALID_ROOM_ID',
        { rooms: [{ guestCount: 2, roomId: 'abc' }] },
        () => undefined,
      ],
      ['INVALID_ROOM_COUNT', { rooms: [] }, () => undefined],
      [
        'ROOM_ALREADY_IN_RESERVATION',
        {
          rooms: [
            { guestCount: 1, roomId: ROOM_201.id },
            { guestCount: 1, roomId: ROOM_201.id },
          ],
        },
        () => undefined,
      ],
      [
        'GUEST_COUNT_TOO_LOW',
        { rooms: [{ guestCount: 0 }, { guestCount: 2 }] },
        () => undefined,
      ],
      [
        'INVALID_GUEST_COUNT',
        { rooms: [{ guestCount: 1.5 }, { guestCount: 2 }] },
        () => undefined,
      ],
      ['INVALID_RESERVATION_DATES', { endDate: '2034-02-09' }, () => undefined],
      ['START_DATE_IN_PAST', { startDate: '2034-01-31' }, () => undefined],
      [
        'INVENTORY_UNAVAILABLE',
        {},
        () => {
          inventoryDown = true;
        },
      ],
      [
        'MAINTENANCE_CHECK_UNAVAILABLE',
        {},
        () => {
          maintenanceDown = true;
        },
      ],
      [
        'ROOM_NOT_AVAILABLE',
        {
          rooms: [
            { guestCount: 2, roomId: ROOM_201.id },
            { guestCount: 2, roomId: ROOM_202.id },
          ],
        },
        () => {
          room202InMaintenance = true;
        },
      ],
      [
        'NO_AVAILABILITY',
        { rooms: [{ guestCount: 1 }, { guestCount: 1 }, { guestCount: 1 }] },
        () => undefined,
      ],
      [
        'GUEST_COUNT_EXCEEDS_CAPACITY',
        { rooms: [{ guestCount: 3, roomId: ROOM_201.id }] },
        () => undefined,
      ],
      [
        'PRICING_UNAVAILABLE',
        {},
        () => {
          pricingDown = true;
        },
      ],
    ];

    it.each(common)('A: %s', async (code, changes, setUp) => {
      setUp();

      const res = await post(PREVIEW, previewBody(changes)).expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(PREVIEW, code)),
      );
    });

    it('A: CURRENCY_MISMATCH, con el Módulo 3 cotizando en dos monedas', async () => {
      mixedCurrencies = true;

      const res = await post(PREVIEW, previewBody()).expect(400);

      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(PREVIEW, 'CURRENCY_MISMATCH')),
      );
    });

    it.each([
      ...common,
      [
        'RATE_CHANGED',
        {
          expectedRates: [
            { position: 1, lodgingAmount: '1.00', currency: 'COP' },
            { position: 2, lodgingAmount: '1.00', currency: 'COP' },
          ],
        },
        () => undefined,
      ],
      ['NOTES_TOO_LONG', { notes: 'x'.repeat(501) }, () => undefined],
      [
        'GUEST_DATA_REQUIRED',
        { guest: { ...GUEST, firstName: '' } },
        () => undefined,
      ],
      [
        'INVALID_DOCUMENT_TYPE',
        { guest: { ...GUEST, documentType: 'DNI' } },
        () => undefined,
      ],
      ['INVALID_CHARACTERS', { notes: 'Llegada\u0000tarde' }, () => undefined],
      [
        'INVALID_EMAIL',
        { guest: { ...GUEST, contactEmail: 'valentina@correo' } },
        () => undefined,
      ],
    ] as [string, object, () => void][])(
      'B: %s',
      async (code, changes, setUp) => {
        setUp();
        // Una estadía de una sola habitación cuando la prueba pide habitaciones por `roomId`: `expectedRates`
        // trae una entrada por habitación.
        const rooms = (changes as { rooms?: unknown[] }).rooms;
        const expectedRates =
          rooms === undefined || rooms.length === 2
            ? undefined
            : rooms.map((_, index) => ({
                position: index + 1,
                lodgingAmount: '750000.00',
                currency: 'COP',
              }));

        const res = await post(
          CREATION,
          creationBody({
            ...(expectedRates === undefined ? {} : { expectedRates }),
            ...changes,
          }),
        ).expect(400);

        expect(comparable(res.body as Record<string, unknown>)).toEqual(
          comparable(errorExample(CREATION, code)),
        );
      },
    );
  });
});
