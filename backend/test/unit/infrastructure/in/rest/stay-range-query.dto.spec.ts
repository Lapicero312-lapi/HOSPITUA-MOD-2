import { describe, expect, it } from 'vitest';
import type { StayRangeReservation } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/find-reservations-by-stay-range.port.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import {
  readStayRangeQuery,
  toStayRangeBody,
} from '../../../../../src/infrastructure/in/rest/stay-range-query.dto.js';

const ROOM_ID = 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b';
const RANGE = { dateFrom: '2026-10-20', dateTo: '2026-10-25' };

function businessErrorOf(query: Record<string, unknown>): BusinessError {
  try {
    readStayRangeQuery(query);
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    return error as BusinessError;
  }
  throw new Error('Se esperaba un BusinessError.');
}

describe('readStayRangeQuery (plan de check-view-reservation, C5 y "Consulta del Módulo 1"; T033)', () => {
  describe('una consulta válida', () => {
    it('con las dos fechas y sin habitación: roomId queda en null', () => {
      expect(readStayRangeQuery(RANGE)).toEqual({ ...RANGE, roomId: null });
    });

    it('con las dos fechas y la habitación', () => {
      expect(readStayRangeQuery({ ...RANGE, roomId: ROOM_ID })).toEqual({
        ...RANGE,
        roomId: ROOM_ID,
      });
    });

    it('un solo día (dateFrom igual a dateTo) es válido', () => {
      expect(
        readStayRangeQuery({ dateFrom: '2026-10-20', dateTo: '2026-10-20' }),
      ).toEqual({ dateFrom: '2026-10-20', dateTo: '2026-10-20', roomId: null });
    });

    it('366 días, contando el primero y el último, es el máximo', () => {
      const query = { dateFrom: '2026-01-01', dateTo: '2027-01-01' };

      expect(readStayRangeQuery(query)).toEqual({ ...query, roomId: null });
    });
  });

  describe('1. un parámetro que no es de esta consulta: UNSUPPORTED_PARAMETER con su nombre', () => {
    it.each([
      'search',
      'status',
      'source',
      'page',
      'order',
      'otaId',
      'inConflict',
    ])('%s', (name) => {
      const error = businessErrorOf({ ...RANGE, [name]: 'x' });

      expect(error.errorCode).toBe('UNSUPPORTED_PARAMETER');
      expect(error.message).toBe(
        `El parámetro ${name} no se admite en esta consulta.`,
      );
    });

    it('con varios, nombra el primero en orden alfabético, sin importar el orden en que llegan', () => {
      const error = businessErrorOf({ ...RANGE, status: 'ACTIVE', page: '2' });

      expect(error.message).toBe(
        'El parámetro page no se admite en esta consulta.',
      );
    });

    it('va antes que las fechas: sin fechas y con un parámetro ajeno responde UNSUPPORTED_PARAMETER', () => {
      expect(businessErrorOf({ status: 'ACTIVE' }).errorCode).toBe(
        'UNSUPPORTED_PARAMETER',
      );
    });
  });

  describe('2. falta una fecha o las dos: INCOMPLETE_DATE_RANGE', () => {
    it.each([
      ['falta dateTo', { dateFrom: '2026-10-20' }],
      ['falta dateFrom', { dateTo: '2026-10-25' }],
      ['faltan las dos', {}],
      ['faltan las dos y viene la habitación', { roomId: ROOM_ID }],
    ])('%s', (_, query) => {
      const error = businessErrorOf(query);

      expect(error.errorCode).toBe('INCOMPLETE_DATE_RANGE');
      expect(error.message).toBe('Debe completar ambas fechas del rango.');
    });

    it('va antes que el formato: una fecha mal formada sin la otra responde INCOMPLETE_DATE_RANGE', () => {
      expect(businessErrorOf({ dateFrom: '20/10/2026' }).errorCode).toBe(
        'INCOMPLETE_DATE_RANGE',
      );
    });
  });

  describe('3. las fechas, con las reglas y los mensajes de C1', () => {
    it.each([
      ['dateFrom con otro formato', { ...RANGE, dateFrom: '20/10/2026' }],
      ['dateTo que no existe', { ...RANGE, dateTo: '2026-02-30' }],
      ['dateFrom vacía', { ...RANGE, dateFrom: '' }],
      [
        'dateFrom repetida',
        { ...RANGE, dateFrom: ['2026-10-20', '2026-10-21'] },
      ],
    ])('%s: INVALID_DATE', (_, query) => {
      const error = businessErrorOf(query);

      expect(error.errorCode).toBe('INVALID_DATE');
      expect(error.message).toBe('La fecha indicada no es válida.');
    });

    it('dateFrom posterior a dateTo: INVALID_DATE_RANGE', () => {
      const error = businessErrorOf({
        dateFrom: '2026-10-25',
        dateTo: '2026-10-20',
      });

      expect(error.errorCode).toBe('INVALID_DATE_RANGE');
      expect(error.message).toBe(
        'La fecha inicial no puede ser posterior a la fecha final.',
      );
    });

    it('367 días: DATE_RANGE_TOO_LARGE', () => {
      const error = businessErrorOf({
        dateFrom: '2026-01-01',
        dateTo: '2027-01-02',
      });

      expect(error.errorCode).toBe('DATE_RANGE_TOO_LARGE');
      expect(error.message).toBe(
        'El rango de fechas no puede superar 366 días.',
      );
    });
  });

  describe('4. roomId que no es un UUID: INVALID_ROOM_ID', () => {
    it.each([
      ['un número de habitación', '204'],
      ['vacío', ''],
      ['repetido', [ROOM_ID, ROOM_ID]],
    ])('%s', (_, roomId) => {
      const error = businessErrorOf({ ...RANGE, roomId });

      expect(error.errorCode).toBe('INVALID_ROOM_ID');
      expect(error.message).toBe(
        'El identificador de la habitación es inválido.',
      );
    });

    it('va después de las fechas: con un rango invertido y un roomId inválido responde INVALID_DATE_RANGE', () => {
      expect(
        businessErrorOf({
          dateFrom: '2026-10-25',
          dateTo: '2026-10-20',
          roomId: '204',
        }).errorCode,
      ).toBe('INVALID_DATE_RANGE');
    });
  });
});

describe('toStayRangeBody (plan de check-view-reservation, C5)', () => {
  it('arma la respuesta del ejemplo de C5', () => {
    const reservation: StayRangeReservation = {
      reservationRef: 'RSV-3F9A1C7B',
      status: 'ACTIVE',
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      rooms: [{ roomId: ROOM_ID, roomNumber: '204', categoryRoom: 'DOBLE' }],
    };

    expect(toStayRangeBody([reservation])).toEqual({
      items: [
        {
          reservationRef: 'RSV-3F9A1C7B',
          status: 'ACTIVE',
          startDate: '2026-10-23',
          endDate: '2026-10-25',
          rooms: [
            { roomId: ROOM_ID, roomNumber: '204', categoryRoom: 'DOBLE' },
          ],
        },
      ],
    });
  });

  it('sin reservas: items vacío y nada más', () => {
    expect(toStayRangeBody([])).toEqual({ items: [] });
  });

  it('solo salen los campos del contrato, aunque el objeto traiga más: ni datos del huésped ni financieros', () => {
    const withExtras = {
      reservationRef: 'RSV-3F9A1C7B',
      status: 'ACTIVE',
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      guest: { fullName: 'Valentina Ospina' },
      rooms: [
        {
          roomId: ROOM_ID,
          roomNumber: '204',
          categoryRoom: 'DOBLE',
          roomGrossAmount: '530000.00',
        },
      ],
    } as unknown as StayRangeReservation;

    const [item] = toStayRangeBody([withExtras]).items;

    expect(Object.keys(item).sort()).toEqual([
      'endDate',
      'reservationRef',
      'rooms',
      'startDate',
      'status',
    ]);
    expect(Object.keys(item.rooms[0]).sort()).toEqual([
      'categoryRoom',
      'roomId',
      'roomNumber',
    ]);
  });
});
