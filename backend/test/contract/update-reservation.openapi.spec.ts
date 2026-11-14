import { Logger, type INestApplication } from '@nestjs/common';
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
import { CANCEL_RESERVATION } from '../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { FIND_RESERVATIONS_BY_STAY_RANGE } from '../../src/application/use-cases/check-view-reservation/ports/in/find-reservations-by-stay-range.port.js';
import { GET_DAY_SUMMARY } from '../../src/application/use-cases/check-view-reservation/ports/in/get-day-summary.port.js';
import { GET_RESERVATION_DETAIL } from '../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import { GET_RESERVATION_FOR_BILLING } from '../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-for-billing.port.js';
import { LIST_RESERVATIONS } from '../../src/application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
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
import {
  MODIFICATION_CONFIRMATION_EXAMPLE,
  MODIFICATION_PREVIEW_EXAMPLE,
  MODIFICATION_REQUEST_EXAMPLE,
  ROOM_ASSIGNMENT_EXAMPLE,
} from '../../src/infrastructure/in/rest/reservation-modification.dto.js';
import { ReservationsController } from '../../src/infrastructure/in/rest/reservations.controller.js';
import { ApiErrorFilter } from '../../src/infrastructure/shared/api-error.filter.js';
import { aDirectReservation, anOtaReservation } from '../support/builders.js';

/**
 * T032 de `update-reservation`: lo que documenta OpenAPI de B1, B2 y B3 es lo que el código hace. Levanta solo
 * `ReservationsController`, con sus casos de uso simulados y el filtro de errores real, así que no necesita
 * la base de datos. Comprueba:
 * - que los errores van uno por código, en el orden en que el código los revisa (regla 3, regla 7 de la
 *   modificación y punto 16), con los mensajes literales del plan;
 * - que los cuerpos de ejemplo pasan los validadores reales, y que los errores de forma documentados son los
 *   que esos validadores lanzan;
 * - que cada error, al producirse, responde `400` con el cuerpo y la ruta del ejemplo.
 *
 * La prueba con la aplicación completa es `reservation-modification.openapi.e2e-spec.ts`.
 */

const PREVIEW = '/api/reservations/{reservationRef}/modification-preview';
const CONFIRMATION = '/api/reservations/{reservationRef}';
const ASSIGNMENT = '/api/reservations/{reservationRef}/room-assignment';
const REF = 'RSV-3F9A1C7B';

/**
 * Los errores de B1, en el orden en que el código los revisa, con el mensaje literal de la tabla de B del plan
 * (`null`: el de otro caso de uso, que solo se comprueba que exista).
 */
const PREVIEW_ERRORS: [string, string | null][] = [
  // Paso 1: la forma del cuerpo, sin consultar nada.
  [
    'INVALID_RESERVATION_DATES',
    'La fecha de salida debe ser posterior a la de entrada.',
  ],
  ['INVALID_ROOM_COUNT', 'Una reserva debe tener entre 1 y 10 habitaciones.'],
  ['INVALID_ROOM_ID', null],
  ['INVALID_GUEST_COUNT', null],
  // Paso 2: la reserva; paso 3: `updatedAt`; paso 4: las fechas.
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
  // Pasos 5 y 6: las habitaciones, con el Módulo 1.
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
  // Paso 7: el titular y las observaciones.
  ['NATIONALITY_NOT_EDITABLE', 'La nacionalidad no se puede modificar.'],
  ['GUEST_DATA_REQUIRED', null],
  ['INVALID_DOCUMENT_TYPE', null],
  [
    'INVALID_CHARACTERS',
    'El formato de los datos contiene caracteres no válidos.',
  ],
  ['NOTES_TOO_LONG', 'Las observaciones no pueden superar 500 caracteres.'],
  ['INVALID_EMAIL', null],
  // Paso 8: la disponibilidad; paso 9: la recotización.
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

/** B2: los de B1 y `RATE_CHANGED` después de la forma del cuerpo (lo lanza `readExpectedRates` en el paso 1). */
const CONFIRMATION_ERRORS: [string, string | null][] = [
  ...PREVIEW_ERRORS.slice(0, 4),
  ['RATE_CHANGED', 'La tarifa cambió, vuelva a cotizar.'],
  ...PREVIEW_ERRORS.slice(4),
];

/** B3: la cabecera `X-User` y los pasos del punto 16 en orden. */
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
    'La habitación 201 no está disponible para el rango de fechas solicitado.',
  ],
  ['MAINTENANCE_CHECK_UNAVAILABLE', null],
];

type ErrorValue = { errorCode: string; message: string; path: string };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, { value: ErrorValue }>;
};
type Operation = {
  responses: Record<string, { content?: Record<string, MediaType> }>;
};

/** Los casos de uso que llama el controlador en estas rutas, simulados. */
const previewModification = { execute: vi.fn() };
const confirmModification = { execute: vi.fn() };
const assignRoom = { execute: vi.fn() };

describe('OpenAPI de B1, B2 y B3: lo documentado es lo que hace el código (T032 de update-reservation)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  const errorsOf = (path: string, method: 'post' | 'patch') =>
    (document.paths[path] as Record<string, Operation>)[method].responses['400']
      .content?.['application/json'].examples ?? {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [
        ...[
          LIST_RESERVATIONS,
          GET_DAY_SUMMARY,
          CANCEL_RESERVATION,
          GET_RESERVATION_DETAIL,
          GET_RESERVATION_FOR_BILLING,
          FIND_RESERVATIONS_BY_STAY_RANGE,
        ].map((token) => ({ provide: token, useValue: {} })),
        { provide: PREVIEW_MODIFICATION, useValue: previewModification },
        { provide: CONFIRM_MODIFICATION, useValue: confirmModification },
        { provide: ASSIGN_ROOM, useValue: assignRoom },
        // El filtro global real: los errores salen con el cuerpo que documentan los ejemplos.
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

  describe('el orden y los mensajes de los errores', () => {
    it.each([
      ['B1', PREVIEW, 'post', PREVIEW_ERRORS],
      ['B2', CONFIRMATION, 'patch', CONFIRMATION_ERRORS],
      ['B3', ASSIGNMENT, 'patch', ASSIGNMENT_ERRORS],
    ] as const)(
      '%s documenta cada código una vez, en el orden en que el código lo revisa, y al final la excepción inesperada',
      (_, path, method, errors) => {
        expect(Object.keys(errorsOf(path, method))).toEqual([
          ...errors.map(([code]) => code),
          'REQUEST_NOT_PROCESSED',
        ]);
      },
    );

    it.each([
      [
        'B1',
        PREVIEW,
        'post',
        PREVIEW_ERRORS,
        `/api/reservations/${REF}/modification-preview`,
      ],
      [
        'B2',
        CONFIRMATION,
        'patch',
        CONFIRMATION_ERRORS,
        `/api/reservations/${REF}`,
      ],
      [
        'B3',
        ASSIGNMENT,
        'patch',
        ASSIGNMENT_ERRORS,
        `/api/reservations/${REF}/room-assignment`,
      ],
    ] as const)(
      '%s: cada ejemplo lleva su código, la ruta de su operación y el mensaje literal del plan',
      (_, path, method, errors, examplePath) => {
        for (const [code, message] of errors) {
          const { value } = errorsOf(path, method)[code];
          expect(value.errorCode, code).toBe(code);
          expect(value.path, code).toBe(examplePath);
          expect(value.message.length, code).toBeGreaterThan(0);
          if (message !== null) {
            expect(value.message, code).toBe(message);
          }
        }
      },
    );

    it('ninguna de las tres documenta INVALID_RESERVATION_CODE: la referencia no se valida por formato, una que no existe es RESERVATION_NOT_FOUND', () => {
      for (const [path, method] of [
        [PREVIEW, 'post'],
        [CONFIRMATION, 'patch'],
        [ASSIGNMENT, 'patch'],
      ] as const) {
        expect(Object.keys(errorsOf(path, method))).not.toContain(
          'INVALID_RESERVATION_CODE',
        );
      }
    });
  });

  describe('los ejemplos frente a los validadores reales', () => {
    it('los cuerpos de ejemplo de B1 y B2 pasan los validadores reales', () => {
      for (const example of [
        MODIFICATION_REQUEST_EXAMPLE,
        MODIFICATION_CONFIRMATION_EXAMPLE,
      ]) {
        expect(() => readModificationRequest(example)).not.toThrow();
        expect(() => readHolderAndNotes(example)).not.toThrow();
      }
      expect(readExpectedRates(MODIFICATION_CONFIRMATION_EXAMPLE)).toHaveLength(
        1,
      );
    });

    it('el ejemplo de B3 trae UUID válidos', () => {
      for (const {
        reservationRoomId,
        roomId,
      } of ROOM_ASSIGNMENT_EXAMPLE.assignments) {
        expect(isValidRoomId(reservationRoomId)).toBe(true);
        expect(isValidRoomId(roomId)).toBe(true);
      }
    });

    it('el ejemplo de la vista previa es coherente: recotiza solo la agregada, con una tarifa por noche', () => {
      const { quotes, changes } = MODIFICATION_PREVIEW_EXAMPLE;

      expect(quotes?.rooms.map(({ key }) => key)).toEqual(changes.roomsAdded);
      expect(quotes?.rooms[0].nightlyRates).toHaveLength(
        quotes?.rooms[0].nights ?? -1,
      );
    });

    it.each([
      [
        'INVALID_RESERVATION_DATES',
        () => readModificationRequest({ startDate: 5 }),
      ],
      ['INVALID_ROOM_COUNT', () => readModificationRequest({ rooms: 'x' })],
      [
        'INVALID_ROOM_ID',
        () =>
          readModificationRequest({ rooms: [{ roomId: 'x', guestCount: 1 }] }),
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
      ['NOTES_TOO_LONG', () => readHolderAndNotes({ notes: 'a'.repeat(501) })],
      ['RATE_CHANGED', () => readExpectedRates({ expectedRates: 'x' })],
    ] as const)(
      'el validador real lanza %s con el mensaje documentado',
      (code, run) => {
        let thrown: { errorCode?: string; message?: string } = {};
        try {
          run();
        } catch (error) {
          thrown = error as typeof thrown;
        }
        const { value } = errorsOf(CONFIRMATION, 'patch')[code];

        expect(thrown.errorCode).toBe(code);
        expect(thrown.message).toBe(value.message);
      },
    );

    it('el orden del titular es el del validador: el correo se revisa después de las observaciones', () => {
      const run = () =>
        readHolderAndNotes({
          guest: {
            firstName: 'Ana',
            lastName: 'Pérez',
            documentType: 'CC',
            documentNumber: '123',
            contactPhone: null,
            contactEmail: 'no-es-correo',
          },
          notes: 'a'.repeat(501),
        });

      expect(run).toThrow(
        expect.objectContaining({ errorCode: 'NOTES_TOO_LONG' }) as Error,
      );
    });
  });

  describe('en ejecución, con el filtro de errores real', () => {
    const detailOf = (reservation: ReturnType<typeof aDirectReservation>) => ({
      reservation,
      nights: 2,
      otaName: null,
      cancellation: null,
    });

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('B1 responde 200 y no 201, y B2 y B3 el detalle con el reservationRoomId de cada habitación', async () => {
      previewModification.execute.mockResolvedValue({
        reservationRef: REF,
        changes: MODIFICATION_PREVIEW_EXAMPLE.changes,
        requiresConfirmation: false,
        availability: [],
        quotes: null,
        reservation: MODIFICATION_PREVIEW_EXAMPLE.reservation,
      });
      confirmModification.execute.mockResolvedValue(
        detailOf(aDirectReservation()),
      );
      assignRoom.execute.mockResolvedValue({
        ...detailOf(anOtaReservation('00000000-0000-4000-8000-000000000001')),
        otaName: 'Booking.com',
      });
      const server = request(app.getHttpServer());

      await server
        .post(`/api/reservations/${REF}/modification-preview`)
        .send(MODIFICATION_REQUEST_EXAMPLE)
        .expect(200);
      const confirmed = await server
        .patch(`/api/reservations/${REF}`)
        .send(MODIFICATION_CONFIRMATION_EXAMPLE)
        .expect(200);
      const assigned = await server
        .patch(`/api/reservations/${REF}/room-assignment`)
        .set('X-User', 'laura.mendez')
        .send(ROOM_ASSIGNMENT_EXAMPLE)
        .expect(200);

      expect(confirmed.body.rooms[0].reservationRoomId).toEqual(
        expect.any(String),
      );
      expect(assigned.body).toMatchObject({ source: 'OTA' });
    });

    it.each([
      [
        'B1',
        'post',
        PREVIEW,
        `/api/reservations/${REF}/modification-preview`,
        previewModification,
        PREVIEW_ERRORS,
      ],
      [
        'B2',
        'patch',
        CONFIRMATION,
        `/api/reservations/${REF}`,
        confirmModification,
        CONFIRMATION_ERRORS,
      ],
      [
        'B3',
        'patch',
        ASSIGNMENT,
        `/api/reservations/${REF}/room-assignment`,
        assignRoom,
        ASSIGNMENT_ERRORS.slice(2),
      ],
    ] as const)(
      '%s: cada error documentado, al producirse, responde 400 con el cuerpo de su ejemplo',
      async (_, method, path, url, useCase, errors) => {
        for (const [code] of errors) {
          const { value } = errorsOf(path, method)[code];
          useCase.execute.mockRejectedValueOnce(
            new BusinessError(value.errorCode, value.message),
          );

          const res = await request(app.getHttpServer())
            [method](url)
            .set('X-User', 'laura.mendez')
            .send({})
            .expect(400);

          expect(res.body, code).toEqual({
            errorCode: value.errorCode,
            message: value.message,
            timestamp: expect.any(String) as string,
            path: value.path,
          });
        }
        // Y la excepción inesperada, con su mensaje.
        useCase.execute.mockRejectedValueOnce(new Error('inesperado'));
        const res = await request(app.getHttpServer())
          [method](url)
          .set('X-User', 'laura.mendez')
          .send({})
          .expect(400);
        expect(res.body).toMatchObject({
          errorCode: 'REQUEST_NOT_PROCESSED',
          message: errorsOf(path, method).REQUEST_NOT_PROCESSED.value.message,
        });
      },
    );

    it.each([
      ['sin X-User', null, 'USER_REQUIRED'],
      [
        'con un X-User de más de 100 caracteres',
        'x'.repeat(101),
        'INVALID_USER',
      ],
    ])(
      'B3 %s responde %s como su ejemplo, sin llamar al caso de uso',
      async (_, user, code) => {
        const call = request(app.getHttpServer()).patch(
          `/api/reservations/${REF}/room-assignment`,
        );

        const res = await (user === null ? call : call.set('X-User', user))
          .send(ROOM_ASSIGNMENT_EXAMPLE)
          .expect(400);

        const { value } = errorsOf(ASSIGNMENT, 'patch')[code];
        expect(res.body).toMatchObject({
          errorCode: value.errorCode,
          message: value.message,
          path: value.path,
        });
        expect(assignRoom.execute).not.toHaveBeenCalled();
      },
    );
  });
});
