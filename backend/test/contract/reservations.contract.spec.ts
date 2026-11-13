import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CANCEL_RESERVATION } from '../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import {
  FIND_RESERVATIONS_BY_STAY_RANGE,
  type FindReservationsByStayRange,
  type StayRangeReservation,
} from '../../src/application/use-cases/check-view-reservation/ports/in/find-reservations-by-stay-range.port.js';
import { GET_DAY_SUMMARY } from '../../src/application/use-cases/check-view-reservation/ports/in/get-day-summary.port.js';
import { GET_RESERVATION_DETAIL } from '../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  GET_RESERVATION_FOR_BILLING,
  type GetReservationForBilling,
  type ReservationForBilling,
} from '../../src/application/use-cases/check-view-reservation/ports/in/get-reservation-for-billing.port.js';
import { LIST_RESERVATIONS } from '../../src/application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { PREVIEW_MODIFICATION } from '../../src/application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import { BusinessError } from '../../src/domain/shared/business-error.js';
import { RESERVATION_NOT_FOUND } from '../../src/domain/shared/error-codes.js';
import { ReservationsController } from '../../src/infrastructure/in/rest/reservations.controller.js';
import { ApiErrorFilter } from '../../src/infrastructure/shared/api-error.filter.js';

/**
 * T034 de `check-view-reservation`: las respuestas de C4 (Módulo 3) y C5 (Módulo 1) tienen la forma exacta
 * del contrato, y la reserva que no existe responde `404` (plan, "Pruebas por escenario": "Pruebas de
 * contrato de C4 y C5: forma exacta y `404`"; y "OpenAPI (T037) y pruebas de contrato (T034)"). Como las
 * demás de `test/contract/`, sin base de datos: el controlador es el real, con el prefijo `/api` y el
 * filtro global, y los casos de uso responden con los datos de los ejemplos del plan.
 */

/** Las dos reservas de los ejemplos de C4 del plan, como las devuelve `GetReservationForBilling`. */
const BILLING: Record<string, ReservationForBilling> = {
  'RSV-3F9A1C7B': {
    reservationRef: 'RSV-3F9A1C7B',
    channel: 'DIRECT',
    quoteIds: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
    ota: null,
  },
  'RSV-8D02E5A4': {
    reservationRef: 'RSV-8D02E5A4',
    channel: 'OTA',
    quoteIds: [],
    ota: {
      otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
      confirmationCode: '4417829013',
      commissionPercentage: '15.00',
    },
  },
  // Un porcentaje con decimales, para ver que el número no se redondea.
  'RSV-0A1B2C3D': {
    reservationRef: 'RSV-0A1B2C3D',
    channel: 'OTA',
    quoteIds: [],
    ota: {
      otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
      confirmationCode: '4417829014',
      commissionPercentage: '12.75',
    },
  },
};

/** La reserva del ejemplo de C5 del plan (el `roomId` "a4c2…" del plan, completo). */
const STAY_RANGE_RESERVATION: StayRangeReservation = {
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
};

const billing: GetReservationForBilling = {
  execute: (reservationRef) => {
    const found = BILLING[reservationRef];
    return found === undefined
      ? Promise.reject(
          new BusinessError(
            RESERVATION_NOT_FOUND.code,
            RESERVATION_NOT_FOUND.message,
          ),
        )
      : Promise.resolve(found);
  },
};

/** El Módulo 1 consulta octubre de 2026 (el ejemplo) o diciembre (sin reservas). */
const stayRange: FindReservationsByStayRange = {
  execute: ({ dateFrom }) =>
    Promise.resolve(
      dateFrom.startsWith('2026-10') ? [STAY_RANGE_RESERVATION] : [],
    ),
};

describe('Contrato de C4 y C5 (T034 de check-view-reservation)', () => {
  let app: INestApplication<App>;

  const detail = (reservationRef: string, client = 'MODULE3') =>
    request(app.getHttpServer())
      .get(`/api/reservations/${reservationRef}`)
      .set('X-Client', client);

  const byDates = (dateFrom: string, dateTo: string, client = 'MODULE1') =>
    request(app.getHttpServer())
      .get('/api/reservations')
      .query({ dateFrom, dateTo })
      .set('X-Client', client);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReservationsController],
      providers: [
        { provide: GET_RESERVATION_FOR_BILLING, useValue: billing },
        { provide: FIND_RESERVATIONS_BY_STAY_RANGE, useValue: stayRange },
        // Las demás rutas del controlador no se usan aquí.
        { provide: LIST_RESERVATIONS, useValue: {} },
        { provide: GET_DAY_SUMMARY, useValue: {} },
        { provide: GET_RESERVATION_DETAIL, useValue: {} },
        { provide: CANCEL_RESERVATION, useValue: {} },
        { provide: PREVIEW_MODIFICATION, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new ApiErrorFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('C4, GET /api/reservations/{reservationRef} con X-Client: MODULE3', () => {
    it('una reserva directa: exactamente el ejemplo del plan, sin los campos de la agencia', async () => {
      const res = await detail('RSV-3F9A1C7B')
        .expect(200)
        .expect('Content-Type', /^application\/json/);

      expect(res.body).toStrictEqual({
        reservationRef: 'RSV-3F9A1C7B',
        channel: 'DIRECT',
        quoteIds: ['8b1f6c0e-7d1a-4c0b-9d5e-2f4f3b6a1c11'],
      });
    });

    it('una reserva de Booking: exactamente el ejemplo del plan, con quoteIds vacía y los tres campos de la agencia', async () => {
      const res = await detail('RSV-8D02E5A4')
        .expect(200)
        .expect('Content-Type', /^application\/json/);

      expect(res.body).toStrictEqual({
        reservationRef: 'RSV-8D02E5A4',
        channel: 'OTA',
        quoteIds: [],
        otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
        otaConfirmationCode: '4417829013',
        otaCommissionPercentage: 15,
      });
    });

    it('el porcentaje sale como número en el texto de la respuesta, no como texto, y con sus decimales', async () => {
      const whole = await detail('RSV-8D02E5A4').expect(200);
      const withDecimals = await detail('RSV-0A1B2C3D').expect(200);

      expect(whole.text).toContain('"otaCommissionPercentage":15}');
      expect(withDecimals.text).toContain('"otaCommissionPercentage":12.75}');
      expect(whole.text).not.toContain('"otaCommissionPercentage":"');
    });

    it('una reserva que no existe responde 404 con el cuerpo de error: la única 404 del Módulo 2', async () => {
      const res = await detail('RSV-FFFFFFFF')
        .expect(404)
        .expect('Content-Type', /^application\/json/);

      expect(Object.keys(res.body as object).sort()).toEqual([
        'errorCode',
        'message',
        'path',
        'timestamp',
      ]);
      expect(res.body).toMatchObject({
        errorCode: 'RESERVATION_NOT_FOUND',
        message: 'La reserva no existe.',
        path: '/api/reservations/RSV-FFFFFFFF',
      });
    });

    it.each([
      ['otro llamador', 'MODULE1'],
      ['un valor desconocido', 'BOOKING'],
    ])(
      'con %s en X-Client responde 400 INVALID_CLIENT, no la consulta',
      async (_case, client) => {
        const res = await detail('RSV-3F9A1C7B', client).expect(400);

        expect(res.body).toMatchObject({ errorCode: 'INVALID_CLIENT' });
      },
    );
  });

  describe('C5, GET /api/reservations con X-Client: MODULE1', () => {
    it('con reservas: exactamente { items } con el ejemplo del plan, sin campos de paginación', async () => {
      const res = await byDates('2026-10-01', '2026-10-31')
        .expect(200)
        .expect('Content-Type', /^application\/json/);

      expect(res.body).toStrictEqual({ items: [STAY_RANGE_RESERVATION] });
    });

    it('sin reservas: { "items": [] } y nada más', async () => {
      const res = await byDates('2026-12-01', '2026-12-31').expect(200);

      expect(res.text).toBe('{"items":[]}');
    });

    it('con otro llamador en X-Client responde 400 INVALID_CLIENT, no la consulta', async () => {
      const res = await byDates('2026-10-01', '2026-10-31', 'MODULE3').expect(
        400,
      );

      expect(res.body).toMatchObject({ errorCode: 'INVALID_CLIENT' });
    });
  });
});
