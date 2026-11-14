import { describe, expect, it } from 'vitest';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import {
  readOtaCommissionQuery,
  toOtaCommissionPageBody,
} from '../../../../../src/infrastructure/in/rest/ota-commission-query.dto.js';

const OTA_ID = '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90';
const RANGE = { dateFrom: '2026-10-01', dateTo: '2026-10-31' };

/** El código con el que la lectura rechaza `query`. */
const codeOf = (query: Record<string, unknown>): string => {
  try {
    readOtaCommissionQuery(query);
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    return (error as BusinessError).errorCode;
  }
  throw new Error('La consulta no se rechazó');
};

describe('readOtaCommissionQuery (A1 de register-ota-information-commission, punto C1; T011)', () => {
  it('solo con las fechas: los demás filtros en null y la página 1', () => {
    expect(readOtaCommissionQuery(RANGE)).toEqual({
      filters: {
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        commissionStatus: null,
        reservationStatus: null,
        otaId: null,
      },
      page: 1,
    });
  });

  it('con todos los filtros', () => {
    expect(
      readOtaCommissionQuery({
        ...RANGE,
        commissionStatus: 'RECONCILED',
        reservationStatus: 'COMPLETED',
        otaId: OTA_ID,
        page: '3',
      }),
    ).toEqual({
      filters: {
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        commissionStatus: 'RECONCILED',
        reservationStatus: 'COMPLETED',
        otaId: OTA_ID,
      },
      page: 3,
    });
  });

  it('los parámetros ajenos se ignoran', () => {
    expect(readOtaCommissionQuery({ ...RANGE, sort: 'desc' }).page).toBe(1);
  });

  describe('las fechas', () => {
    it.each([
      ['sin ninguna', {}],
      ['sin dateTo', { dateFrom: '2026-10-01' }],
      ['sin dateFrom', { dateTo: '2026-10-31' }],
    ])('%s: INCOMPLETE_DATE_RANGE', (_, query) => {
      expect(codeOf(query)).toBe('INCOMPLETE_DATE_RANGE');
    });

    it.each([
      ['una que no existe', { dateFrom: '2026-02-30', dateTo: '2026-03-31' }],
      ['con otro formato', { dateFrom: '01/10/2026', dateTo: '2026-10-31' }],
      [
        'repetida',
        { dateFrom: ['2026-10-01', '2026-10-02'], dateTo: '2026-10-31' },
      ],
    ])('%s: INVALID_DATE', (_, query) => {
      expect(codeOf(query)).toBe('INVALID_DATE');
    });

    it('dateFrom posterior a dateTo: INVALID_DATE_RANGE', () => {
      expect(codeOf({ dateFrom: '2026-10-31', dateTo: '2026-10-01' })).toBe(
        'INVALID_DATE_RANGE',
      );
    });

    it('366 días se aceptan; 367, DATE_RANGE_TOO_LARGE', () => {
      expect(
        readOtaCommissionQuery({ dateFrom: '2028-01-01', dateTo: '2028-12-31' })
          .filters.dateTo,
      ).toBe('2028-12-31');
      expect(codeOf({ dateFrom: '2027-01-01', dateTo: '2028-01-02' })).toBe(
        'DATE_RANGE_TOO_LARGE',
      );
    });

    it('el mismo día en los dos extremos se acepta', () => {
      expect(
        readOtaCommissionQuery({ dateFrom: '2026-10-01', dateTo: '2026-10-01' })
          .filters.dateFrom,
      ).toBe('2026-10-01');
    });
  });

  it.each([
    [
      'commissionStatus',
      { commissionStatus: 'PENDIENTE' },
      'INVALID_COMMISSION_STATUS',
    ],
    ['reservationStatus', { reservationStatus: 'X' }, 'INVALID_STATUS'],
    ['otaId que no es un UUID', { otaId: 'booking' }, 'OTA_NOT_FOUND'],
    ['page 0', { page: '0' }, 'INVALID_PAGE'],
    ['page decimal', { page: '1.5' }, 'INVALID_PAGE'],
    ['page con letras', { page: 'uno' }, 'INVALID_PAGE'],
  ])('%s inválido: %s', (_, changes, code) => {
    expect(codeOf({ ...RANGE, ...changes })).toBe(code);
  });

  it.each([
    [
      'las fechas antes que commissionStatus',
      { dateFrom: '2026-10-01', commissionStatus: 'X' },
      'INCOMPLETE_DATE_RANGE',
    ],
    [
      'commissionStatus antes que reservationStatus',
      { ...RANGE, commissionStatus: 'X', reservationStatus: 'X' },
      'INVALID_COMMISSION_STATUS',
    ],
    [
      'reservationStatus antes que otaId',
      { ...RANGE, reservationStatus: 'X', otaId: 'x' },
      'INVALID_STATUS',
    ],
    [
      'otaId antes que page',
      { ...RANGE, otaId: 'x', page: '0' },
      'OTA_NOT_FOUND',
    ],
  ])('el orden: %s', (_, query, code) => {
    expect(codeOf(query)).toBe(code);
  });
});

describe('toOtaCommissionPageBody (A1)', () => {
  it('los importes con dos decimales y su moneda, y el porcentaje como número', () => {
    const body = toOtaCommissionPageBody({
      items: [
        {
          reservationRef: 'RSV-8D02E5A4',
          otaId: OTA_ID,
          otaName: 'Booking.com',
          externalConfirmationCode: '4417829013',
          status: 'COMPLETED',
          startDate: '2026-10-10',
          endDate: '2026-10-12',
          grossAmount: Money.of('400', 'USD'),
          commissionPercentage: '15.00',
          commissionAmount: Money.of('60', 'USD'),
          commissionStatus: 'CALCULATED',
        },
      ],
      page: 1,
      pageSize: 100,
      totalItems: 1,
      totalPages: 1,
    });

    expect(body).toEqual({
      items: [
        {
          reservationRef: 'RSV-8D02E5A4',
          otaId: OTA_ID,
          otaName: 'Booking.com',
          externalConfirmationCode: '4417829013',
          status: 'COMPLETED',
          startDate: '2026-10-10',
          endDate: '2026-10-12',
          grossAmount: { amount: '400.00', currency: 'USD' },
          commissionPercentage: 15,
          commissionAmount: { amount: '60.00', currency: 'USD' },
          commissionStatus: 'CALCULATED',
        },
      ],
      page: 1,
      pageSize: 100,
      totalItems: 1,
      totalPages: 1,
    });
  });
});
