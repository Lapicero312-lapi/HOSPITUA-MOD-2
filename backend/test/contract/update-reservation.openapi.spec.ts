import { type INestApplication, Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { FIND_RESERVATIONS_BY_STAY_RANGE } from '../../src/application/use-cases/check-view-reservation/ports/in/find-reservations-by-stay-range.port.js';
import { GET_DAY_SUMMARY } from '../../src/application/use-cases/check-view-reservation/ports/in/get-day-summary.port.js';
import { GET_RESERVATION_DETAIL } from '../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import { GET_RESERVATION_FOR_BILLING } from '../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-for-billing.port.js';
import { LIST_RESERVATIONS } from '../../src/application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { CANCEL_RESERVATION } from '../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { isValidRoomId } from '../../src/application/use-cases/consult-room-inventory/room-id.validator.js';
import {
  readExpectedRates,
  readHolderAndNotes,
  readModificationRequest,
} from '../../src/application/use-cases/update-reservation/modification-request.validator.js';
import { ASSIGN_ROOM } from '../../src/application/use-cases/update-reservation/ports/in/assign-room.port.js';
import { CONFIRM_MODIFICATION } from '../../src/application/use-cases/update-reservation/ports/in/confirm-modification.port.js';
import { PREVIEW_MODIFICATION } from '../../src/application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import { API_PREFIX } from '../../src/configure-app.js';
import { BusinessError } from '../../src/domain/shared/business-error.js';
import { ApiErrorFilter } from '../../src/infrastructure/shared/api-error.filter.js';
import { aDirectReservation, anOtaReservation } from '../support/builders.js';
import {
  MODIFICATION_CONFIRMATION_EXAMPLE,
  MODIFICATION_PREVIEW_EXAMPLE,
  MODIFICATION_REQUEST_EXAMPLE,
  ROOM_ASSIGNMENT_REQUEST_EXAMPLE,
} from '../../src/infrastructure/in/rest/reservation-modification.dto.js';
import { ReservationsController } from '../../src/infrastructure/in/rest/reservations.controller.js';

/**
 * T032 de `update-reservation`: la documentación OpenAPI de B1, B2 y B3, contra el contrato B, las reglas 3, 7
 * y 8 y el punto 16 del plan. Levanta solo el controlador, con sus casos de uso simulados: no necesita la base
 * de datos ni Docker. Además de la forma del documento, comprueba que los ejemplos son los que el código
 * real aceptaría (los cuerpos) o respondería (los errores de forma), y que los mensajes son los literales del
 * plan.
 */

const PREVIEW = '/api/reservations/{reservationRef}/modification-preview';
const CONFIRMATION = '/api/reservations/{reservationRef}';
const ASSIGNMENT = '/api/reservations/{reservationRef}/room-assignment';

type Example = {
  summary: string;
  value: { errorCode: string; message: string; path: string };
};
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example & { value: Record<string, unknown> }>;
};
type Operation = {
  summary?: string;
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<string, { content?: Record<string, MediaType> }>;
};
type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

/** La vista previa mínima que devuelve el caso de uso simulado de B1: sin cotizaciones ni disponibilidad. */
const MINIMAL_PREVIEW = {
  reservationRef: 'RSV-3F9A1C7B',
  changes: {
    dates: false,
    roomsAdded: [],
    roomsRemoved: [],
    roomsSwapped: [],
    guestCountChanged: false,
    guestChanged: false,
    notesChanged: false,
  },
  requiresConfirmation: false,
  availability: [],
  quotes: null,
  reservation: {
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    guestCount: 2,
  },
};

/** Los tres casos de uso de `update-reservation` que llama el controlador, simulados. */
const previewModification = { execute: vi.fn() };
const confirmModification = { execute: vi.fn() };
const assignRoom = { execute: vi.fn() };

/** Los demás casos de uso que pide `ReservationsController`: ninguno se llama en esta prueba. */
const OTHER_STUBS = [
  LIST_RESERVATIONS,
  GET_DAY_SUMMARY,
  CANCEL_RESERVATION,
  GET_RESERVATION_DETAIL,
  GET_RESERVATION_FOR_BILLING,
  FIND_RESERVATIONS_BY_STAY_RANGE,
];

/**
 * Los errores de B1 y B2 con los mensajes literales de la tabla de B del plan, en el orden en que se revisan
 * (regla 3). Los de los otros módulos traen su propio mensaje.
 */
const MODIFICATION_ERRORS: [string, string | null][] = [
  [
    'INVALID_RESERVATION_DATES',
    'La fecha de salida debe ser posterior a la de entrada.',
  ],
  ['INVALID_ROOM_COUNT', 'Una reserva debe tener entre 1 y 10 habitaciones.'],
  ['INVALID_ROOM_ID', null],
  ['INVALID_GUEST_COUNT', null],
  ['RESERVATION_NOT_FOUND', 'La reserva no existe.'],
  [
    'OTA_RESERVATION_READ_ONLY',
    'Las reservas de OTA solo las modifica Booking. Si está en conflicto, solo se le puede asignar la habitación.',
  ],
  [
    'STATUS_NOT_EDITABLE',
    'El estado actual de la reserva no admite modificaciones.',
  ],
  [
    'CONCURRENT_UPDATE',
    'Esta reserva ya fue actualizada o cancelada recientemente',
  ],
  ['START_DATE_IN_PAST', 'La fecha de entrada no puede ser anterior a hoy.'],
  [
    'LAST_ROOM_CANNOT_BE_REMOVED',
    'La reserva debe conservar al menos una habitación.',
  ],
  [
    'ROOM_ALREADY_IN_RESERVATION',
    'La habitación ya forma parte de la reserva.',
  ],
  ['INVENTORY_UNAVAILABLE', null],
  ['GUEST_COUNT_TOO_LOW', 'Cada habitación debe tener al menos una persona.'],
  [
    'GUEST_COUNT_EXCEEDS_CAPACITY',
    'La cantidad de personas supera la capacidad de la habitación.',
  ],
  ['NATIONALITY_NOT_EDITABLE', 'La nacionalidad no se puede modificar.'],
  ['GUEST_DATA_REQUIRED', null],
  ['INVALID_DOCUMENT_TYPE', null],
  ['INVALID_EMAIL', null],
  [
    'INVALID_CHARACTERS',
    'El formato de los datos contiene caracteres no válidos.',
  ],
  ['NOTES_TOO_LONG', 'Las observaciones no pueden superar 500 caracteres.'],
  [
    'ROOM_NOT_AVAILABLE',
    'La habitación 305 no está disponible para el rango de fechas solicitado.',
  ],
  ['MAINTENANCE_CHECK_UNAVAILABLE', null],
  [
    'RECALCULATION_UNAVAILABLE',
    'No se pudo calcular la nueva tarifa en este momento. Intente más tarde.',
  ],
];

const ASSIGNMENT_ERRORS: [string, string | null][] = [
  ['USER_REQUIRED', 'Falta el usuario que hace la acción.'],
  ['INVALID_USER', 'El usuario que hace la acción no es válido.'],
  ['INVALID_ROOM_ID', null],
  [
    'ROOM_ALREADY_IN_RESERVATION',
    'La habitación ya forma parte de la reserva.',
  ],
  ['RESERVATION_NOT_FOUND', 'La reserva no existe.'],
  [
    'RESERVATION_NOT_IN_CONFLICT',
    'Solo se puede asignar habitación a una reserva de Booking en conflicto.',
  ],
  [
    'STATUS_NOT_EDITABLE',
    'El estado actual de la reserva no admite modificaciones.',
  ],
  [
    'CONCURRENT_UPDATE',
    'Esta reserva ya fue actualizada o cancelada recientemente',
  ],
  ['ROOM_ALREADY_ASSIGNED', 'Esa habitación de la reserva ya está asignada.'],
  ['INVENTORY_UNAVAILABLE', null],
  ['CATEGORY_MISMATCH', 'La habitación debe ser de la misma categoría.'],
  [
    'GUEST_COUNT_EXCEEDS_CAPACITY',
    'La cantidad de personas supera la capacidad de la habitación.',
  ],
  [
    'ROOM_NOT_AVAILABLE',
    'La habitación 204 no está disponible para el rango de fechas solicitado.',
  ],
  ['MAINTENANCE_CHECK_UNAVAILABLE', null],
];

describe('OpenAPI de B1, B2 y B3 de update-reservation (T032)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [
        ...OTHER_STUBS.map((token) => ({ provide: token, useValue: {} })),
        { provide: PREVIEW_MODIFICATION, useValue: previewModification },
        { provide: CONFIRM_MODIFICATION, useValue: confirmModification },
        { provide: ASSIGN_ROOM, useValue: assignRoom },
        // El filtro global real: así los errores salen con el cuerpo que documentan los ejemplos.
        { provide: APP_FILTER, useClass: ApiErrorFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix(API_PREFIX);
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app?.close();
  });

  const operation = (path: string, method: 'post' | 'patch') =>
    (document.paths[path] as Record<string, Operation>)[method];
  const body = (path: string, method: 'post' | 'patch') =>
    operation(path, method).requestBody?.content['application/json'];
  const response = (path: string, method: 'post' | 'patch', status: string) =>
    operation(path, method).responses[status].content?.['application/json'];
  const schema = (name: string) =>
    document.components?.schemas?.[name] as Schema;
  const fields = (name: string) => Object.keys(schema(name).properties).sort();
  const refName = (media: MediaType | undefined) =>
    String(media?.schema?.$ref).split('/').pop() as string;

  describe('las rutas', () => {
    it.each([
      ['B1', PREVIEW, 'post'],
      ['B2', CONFIRMATION, 'patch'],
      ['B3', ASSIGNMENT, 'patch'],
    ] as const)('%s está documentada, con su resumen', (_, path, method) => {
      const documented = operation(path, method);

      expect(documented).toBeDefined();
      expect(documented.summary?.length).toBeGreaterThan(40);
    });

    it.each([
      ['B1', PREVIEW, 'post'],
      ['B2', CONFIRMATION, 'patch'],
      ['B3', ASSIGNMENT, 'patch'],
    ] as const)(
      '%s documenta la referencia de la reserva con su formato',
      (_, path, method) => {
        const parameter = operation(path, method).parameters?.find(
          ({ name }) => name === 'reservationRef',
        );

        expect(parameter).toMatchObject({ in: 'path', required: true });
        expect(parameter?.schema?.pattern).toBe('^RSV-[0-9A-F]{8}$');
      },
    );

    it('solo B3 pide la cabecera X-User; B1 y B2 no leen ninguna cabecera de quién llama', () => {
      const headers = (path: string, method: 'post' | 'patch') =>
        (operation(path, method).parameters ?? [])
          .filter(({ in: place }) => place === 'header')
          .map(({ name }) => name);

      expect(headers(ASSIGNMENT, 'patch')).toEqual(['X-User']);
      expect(
        operation(ASSIGNMENT, 'patch').parameters?.find(
          ({ name }) => name === 'X-User',
        )?.required,
      ).toBe(true);
      expect(headers(PREVIEW, 'post')).toEqual([]);
      expect(headers(CONFIRMATION, 'patch')).toEqual([]);
    });

    it('B1, B2 y B3 responden 200 y ninguna 201: la vista previa no crea nada', () => {
      for (const [path, method] of [
        [PREVIEW, 'post'],
        [CONFIRMATION, 'patch'],
        [ASSIGNMENT, 'patch'],
      ] as const) {
        const statuses = Object.keys(operation(path, method).responses);

        expect(statuses, `${method} ${path}`).toContain('200');
        expect(statuses, `${method} ${path}`).not.toContain('201');
      }
    });
  });

  describe('los cuerpos', () => {
    it('B1 y B2 usan el cuerpo de cambio: solo updatedAt es obligatorio y el titular no lleva nationality', () => {
      expect(refName(body(PREVIEW, 'post'))).toBe('ModificationRequestDto');
      expect(fields('ModificationRequestDto')).toEqual(
        ['endDate', 'guest', 'notes', 'rooms', 'startDate', 'updatedAt'].sort(),
      );
      expect(schema('ModificationRequestDto').required).toEqual(['updatedAt']);
      expect(fields('ModificationGuestDto')).toEqual(
        [
          'contactEmail',
          'contactPhone',
          'documentNumber',
          'documentType',
          'firstName',
          'lastName',
        ].sort(),
      );
      expect(fields('ModificationGuestDto')).not.toContain('nationality');
    });

    it('B2 agrega expectedRates al cuerpo de cambio, con roomId, lodgingAmount y currency', () => {
      expect(refName(body(CONFIRMATION, 'patch'))).toBe(
        'ModificationConfirmationRequestDto',
      );
      expect(fields('ModificationConfirmationRequestDto')).toContain(
        'expectedRates',
      );
      expect(fields('ModificationExpectedRateDto')).toEqual(
        ['currency', 'lodgingAmount', 'roomId'].sort(),
      );
    });

    it('B3 pide updatedAt y de 1 a 10 asignaciones con reservationRoomId y roomId', () => {
      expect(refName(body(ASSIGNMENT, 'patch'))).toBe(
        'RoomAssignmentRequestDto',
      );
      expect(schema('RoomAssignmentRequestDto').required?.sort()).toEqual([
        'assignments',
        'updatedAt',
      ]);
      expect(
        schema('RoomAssignmentRequestDto').properties.assignments,
      ).toMatchObject({
        minItems: 1,
        maxItems: 10,
      });
      expect(schema('RoomAssignmentDto').required?.sort()).toEqual([
        'reservationRoomId',
        'roomId',
      ]);
    });

    it.each([
      ['B1', PREVIEW, 'post', MODIFICATION_REQUEST_EXAMPLE],
      ['B2', CONFIRMATION, 'patch', MODIFICATION_CONFIRMATION_EXAMPLE],
      ['B3', ASSIGNMENT, 'patch', ROOM_ASSIGNMENT_REQUEST_EXAMPLE],
    ] as const)(
      '%s trae el ejemplo del plan como ejemplo del cuerpo',
      (_, path, method, example) => {
        expect(body(path, method)?.examples?.PLAN?.value).toEqual(example);
      },
    );

    it('los ejemplos de B1 y B2 pasan los validadores reales del cuerpo', () => {
      for (const example of [
        MODIFICATION_REQUEST_EXAMPLE,
        MODIFICATION_CONFIRMATION_EXAMPLE,
      ]) {
        expect(() => readModificationRequest(example)).not.toThrow();
        expect(() => readHolderAndNotes(example)).not.toThrow();
      }
      expect(() =>
        readExpectedRates(MODIFICATION_CONFIRMATION_EXAMPLE),
      ).not.toThrow();
      expect(
        readModificationRequest(MODIFICATION_REQUEST_EXAMPLE),
      ).toMatchObject({
        expectedUpdatedAt: MODIFICATION_REQUEST_EXAMPLE.updatedAt,
        startDate: '2026-10-12',
        endDate: '2026-10-15',
      });
    });

    it('el ejemplo de B3 trae UUID válidos, de 1 asignación', () => {
      const { assignments } = ROOM_ASSIGNMENT_REQUEST_EXAMPLE;

      expect(assignments).toHaveLength(1);
      for (const { reservationRoomId, roomId } of assignments) {
        expect(isValidRoomId(reservationRoomId)).toBe(true);
        expect(isValidRoomId(roomId)).toBe(true);
      }
    });
  });

  describe('las respuestas 200', () => {
    it('B1 documenta la vista previa con los campos del plan y su ejemplo', () => {
      expect(refName(response(PREVIEW, 'post', '200'))).toBe(
        'ModificationPreviewDto',
      );
      expect(fields('ModificationPreviewDto')).toEqual(
        [
          'availability',
          'changes',
          'quotes',
          'requiresConfirmation',
          'reservation',
          'reservationRef',
        ].sort(),
      );
      expect(fields('ModificationChangesDto')).toEqual(
        [
          'dates',
          'guestChanged',
          'guestCountChanged',
          'notesChanged',
          'roomsAdded',
          'roomsRemoved',
          'roomsSwapped',
        ].sort(),
      );
      expect(response(PREVIEW, 'post', '200')?.example).toEqual(
        MODIFICATION_PREVIEW_EXAMPLE,
      );
    });

    it('el ejemplo de B1 es coherente: solo recotiza la habitación agregada y el total no es la suma de lo recotizado', () => {
      const { quotes, changes, requiresConfirmation, availability } =
        MODIFICATION_PREVIEW_EXAMPLE;

      expect(changes.roomsAdded).toEqual(quotes?.rooms.map(({ key }) => key));
      expect(requiresConfirmation).toBe(true);
      expect(availability.rooms.every(({ available }) => available)).toBe(true);
      expect(quotes?.rooms[0].nightlyRates).toHaveLength(
        quotes?.rooms[0].nights ?? -1,
      );
      expect(quotes?.rooms[0].lodgingAmount.amount).toBe('1440000.00');
      expect(quotes?.total.amount).toBe('2130000.00');
    });

    it('B2 y B3 documentan el detalle de la reserva (C3), con el reservationRoomId de cada habitación', () => {
      expect(refName(response(CONFIRMATION, 'patch', '200'))).toBe(
        'ReservationDetailDto',
      );
      expect(refName(response(ASSIGNMENT, 'patch', '200'))).toBe(
        'ReservationDetailDto',
      );
      expect(fields('ReservationDetailRoomDto')).toContain('reservationRoomId');
    });

    it('el ejemplo de B3 es una reserva de Booking sin conflicto con su habitación asignada', () => {
      const example = response(ASSIGNMENT, 'patch', '200')?.example as {
        source: string;
        conflict: unknown;
        rooms: { roomId: string | null; roomNumber: string | null }[];
      };

      expect(example.source).toBe('OTA');
      expect(example.conflict).toBeNull();
      expect(example.rooms.every(({ roomId }) => roomId !== null)).toBe(true);
    });
  });

  describe('los errores 400', () => {
    const errorKeys = (path: string, method: 'post' | 'patch') =>
      Object.keys(response(path, method, '400')?.examples ?? {});
    const errorExample = (
      path: string,
      method: 'post' | 'patch',
      code: string,
    ) =>
      response(path, method, '400')?.examples?.[code]?.value as {
        errorCode: string;
        message: string;
        path: string;
      };

    it('B1 documenta cada código de la tabla de B, en el orden en que se revisan, y no RATE_CHANGED', () => {
      expect(errorKeys(PREVIEW, 'post')).toEqual([
        ...MODIFICATION_ERRORS.map(([code]) => code),
        'REQUEST_NOT_PROCESSED',
      ]);
      expect(errorKeys(PREVIEW, 'post')).not.toContain('RATE_CHANGED');
    });

    it('B2 documenta los mismos y, además, RATE_CHANGED antes de la excepción inesperada', () => {
      expect(errorKeys(CONFIRMATION, 'patch')).toEqual([
        ...MODIFICATION_ERRORS.map(([code]) => code),
        'RATE_CHANGED',
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it('B3 documenta cada código de su tabla y del punto 16, en el orden de sus pasos', () => {
      expect(errorKeys(ASSIGNMENT, 'patch')).toEqual([
        ...ASSIGNMENT_ERRORS.map(([code]) => code),
        'REQUEST_NOT_PROCESSED',
      ]);
    });

    it.each([
      [
        'B1',
        PREVIEW,
        'post',
        MODIFICATION_ERRORS,
        '/api/reservations/RSV-3F9A1C7B/modification-preview',
      ],
      [
        'B2',
        CONFIRMATION,
        'patch',
        MODIFICATION_ERRORS,
        '/api/reservations/RSV-3F9A1C7B',
      ],
      [
        'B3',
        ASSIGNMENT,
        'patch',
        ASSIGNMENT_ERRORS,
        '/api/reservations/RSV-3F9A1C7B/room-assignment',
      ],
    ] as const)(
      '%s: cada ejemplo lleva su código, su ruta y el mensaje literal del plan',
      (_, path, method, errors, examplePath) => {
        for (const [code, message] of errors) {
          const example = errorExample(path, method, code);

          expect(example.errorCode, code).toBe(code);
          expect(example.path, code).toBe(examplePath);
          expect(example.message.length, code).toBeGreaterThan(0);
          if (message !== null) {
            expect(example.message, code).toBe(message);
          }
        }
      },
    );

    it('RATE_CHANGED y REQUEST_NOT_PROCESSED llevan su mensaje del plan', () => {
      expect(errorExample(CONFIRMATION, 'patch', 'RATE_CHANGED').message).toBe(
        'La tarifa cambió, vuelva a cotizar.',
      );
      expect(
        errorExample(CONFIRMATION, 'patch', 'REQUEST_NOT_PROCESSED').errorCode,
      ).toBe('REQUEST_NOT_PROCESSED');
    });

    it('un error de forma del cuerpo es el que el validador real responde, con el mismo mensaje documentado', () => {
      const cases: [string, () => unknown][] = [
        [
          'INVALID_RESERVATION_DATES',
          () => readModificationRequest({ startDate: 5 }),
        ],
        ['INVALID_ROOM_COUNT', () => readModificationRequest({ rooms: 'x' })],
        [
          'INVALID_ROOM_ID',
          () =>
            readModificationRequest({
              rooms: [{ roomId: 'x', guestCount: 1 }],
            }),
        ],
        [
          'INVALID_GUEST_COUNT',
          () =>
            readModificationRequest({
              rooms: [
                {
                  roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
                  guestCount: 'dos',
                },
              ],
            }),
        ],
        [
          'NATIONALITY_NOT_EDITABLE',
          () => readHolderAndNotes({ guest: { nationality: 'Colombia' } }),
        ],
        ['GUEST_DATA_REQUIRED', () => readHolderAndNotes({ guest: {} })],
        ['INVALID_CHARACTERS', () => readHolderAndNotes({ notes: 5 })],
      ];

      for (const [code, run] of cases) {
        let thrown: { errorCode?: string; message?: string } = {};
        try {
          run();
        } catch (error) {
          thrown = error as typeof thrown;
        }
        const documented = errorExample(PREVIEW, 'post', code);

        expect(thrown.errorCode, code).toBe(code);
        expect(thrown.message, code).toBe(documented.message);
      }
    });
  });
  describe('en ejecución, con el filtro de errores real', () => {
    const REF = 'RSV-3F9A1C7B';
    /** El ejemplo documentado de un código de error, tal como lo trae el documento. */
    const documented = (
      path: string,
      method: 'post' | 'patch',
      code: string,
    ) => {
      const examples = response(path, method, '400')?.examples ?? {};
      return (examples[code] as { value: { message: string; path: string } })
        .value;
    };
    const detailOf = (reservation: ReturnType<typeof aDirectReservation>) => ({
      reservation,
      nights: 2,
      otaName: null,
      cancellation: null,
    });
    const send = (method: 'post' | 'patch', path: string, headers = {}) =>
      request(app.getHttpServer())[method](path).set(headers).send({});

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('B1 responde 200 y no 201: la vista previa no crea nada', async () => {
      previewModification.execute.mockResolvedValue(MINIMAL_PREVIEW);

      const response = await request(app.getHttpServer())
        .post(`/api/reservations/${REF}/modification-preview`)
        .send(MODIFICATION_REQUEST_EXAMPLE)
        .expect(200);

      expect(response.body).toMatchObject({
        reservationRef: REF,
        requiresConfirmation: false,
        quotes: null,
        availability: { rooms: [] },
      });
      expect(previewModification.execute).toHaveBeenCalledWith(
        REF,
        MODIFICATION_REQUEST_EXAMPLE,
      );
    });

    it('B2 responde 200 con el detalle de la reserva y el reservationRoomId de cada habitación', async () => {
      confirmModification.execute.mockResolvedValue(
        detailOf(aDirectReservation()),
      );

      const response = await request(app.getHttpServer())
        .patch(`/api/reservations/${REF}`)
        .send(MODIFICATION_CONFIRMATION_EXAMPLE)
        .expect(200);

      expect(response.body.rooms[0].reservationRoomId).toEqual(
        expect.any(String),
      );
      expect(confirmModification.execute).toHaveBeenCalledWith(
        REF,
        MODIFICATION_CONFIRMATION_EXAMPLE,
      );
    });

    it('B3 responde 200 con el detalle de la reserva de Booking', async () => {
      assignRoom.execute.mockResolvedValue({
        ...detailOf(anOtaReservation('00000000-0000-4000-8000-000000000001')),
        otaName: 'Booking.com',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/reservations/${REF}/room-assignment`)
        .set('X-User', 'laura.mendez')
        .send(ROOM_ASSIGNMENT_REQUEST_EXAMPLE)
        .expect(200);

      expect(response.body).toMatchObject({
        source: 'OTA',
        otaName: 'Booking.com',
      });
      expect(assignRoom.execute).toHaveBeenCalledWith(
        REF,
        ROOM_ASSIGNMENT_REQUEST_EXAMPLE,
      );
    });

    it.each([
      [
        'B1',
        'post',
        PREVIEW,
        `/api/reservations/${REF}/modification-preview`,
        previewModification,
        [...MODIFICATION_ERRORS.map(([code]) => code), 'REQUEST_NOT_PROCESSED'],
      ],
      [
        'B2',
        'patch',
        CONFIRMATION,
        `/api/reservations/${REF}`,
        confirmModification,
        [
          ...MODIFICATION_ERRORS.map(([code]) => code),
          'RATE_CHANGED',
          'REQUEST_NOT_PROCESSED',
        ],
      ],
      [
        'B3',
        'patch',
        ASSIGNMENT,
        `/api/reservations/${REF}/room-assignment`,
        assignRoom,
        [
          ...ASSIGNMENT_ERRORS.map(([code]) => code).filter(
            (code) => !code.startsWith('USER') && code !== 'INVALID_USER',
          ),
          'REQUEST_NOT_PROCESSED',
        ],
      ],
    ] as const)(
      '%s: cada error documentado sale 400 con el cuerpo { errorCode, message, timestamp, path } y la ruta del ejemplo',
      async (_, method, documentedPath, path, useCase, codes) => {
        for (const code of codes) {
          const example = documented(documentedPath, method, code);
          useCase.execute.mockRejectedValueOnce(
            code === 'REQUEST_NOT_PROCESSED'
              ? new Error('falla inesperada')
              : new BusinessError(code, example.message),
          );

          const response = await send(method, path, {
            'X-User': 'laura.mendez',
          });

          expect(response.status, code).toBe(400);
          expect(Object.keys(response.body).sort(), code).toEqual([
            'errorCode',
            'message',
            'path',
            'timestamp',
          ]);
          expect(response.body.errorCode, code).toBe(code);
          expect(response.body.message, code).toBe(example.message);
          expect(response.body.path, code).toBe(example.path);
        }
      },
    );

    it('B3 sin X-User responde 400 USER_REQUIRED y con X-User de más de 100 caracteres, INVALID_USER, como documenta', async () => {
      for (const [code, headers] of [
        ['USER_REQUIRED', {}],
        ['INVALID_USER', { 'X-User': 'u'.repeat(101) }],
      ] as const) {
        const example = documented(ASSIGNMENT, 'patch', code);

        const response = await send(
          'patch',
          `/api/reservations/${REF}/room-assignment`,
          headers,
        );

        expect(response.status, code).toBe(400);
        expect(response.body.errorCode, code).toBe(code);
        expect(response.body.message, code).toBe(example.message);
        expect(assignRoom.execute).not.toHaveBeenCalled();
      }
    });
  });
});
