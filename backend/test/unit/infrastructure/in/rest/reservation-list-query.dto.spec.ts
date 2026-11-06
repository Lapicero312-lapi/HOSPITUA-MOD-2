import { describe, expect, it } from 'vitest';
import { readReservationListQuery } from '../../../../../src/infrastructure/in/rest/reservation-list-query.dto.js';

/** Los mensajes literales de la tabla de errores de C1 del plan (FR-009). */
const MESSAGES: Record<string, string> = {
  INVALID_RESERVATION_CODE:
    'Debe proveer un código de reserva válido para la consulta.',
  INVALID_STATUS: 'El estado indicado no es válido.',
  INVALID_CHANNEL: 'El canal indicado no es válido.',
  INVALID_DATE: 'La fecha indicada no es válida.',
  INCOMPLETE_DATE_RANGE: 'Debe completar ambas fechas del rango.',
  INVALID_DATE_RANGE:
    'La fecha inicial no puede ser posterior a la fecha final.',
  DATE_RANGE_TOO_LARGE: 'El rango de fechas no puede superar 366 días.',
  INVALID_SORT_ORDER: 'El orden indicado no es válido.',
  INVALID_PAGE: 'El número de página debe ser 1 o mayor.',
  INVALID_OTA_ID: 'La agencia indicada no es válida.',
  AGENCY_REQUIRES_OTA_CHANNEL:
    'La agencia solo aplica a reservas del canal OTA.',
  INVALID_CONFLICT_FILTER: 'El filtro de conflicto no es válido.',
};

const OTA_ID = '0f8b2c4e-6a1d-4e3f-9b7c-5d2a1e0f3c4b';

/** El error que responde, con su código y su mensaje literal. */
function errorOf(query: Record<string, unknown>) {
  try {
    readReservationListQuery(query);
  } catch (error) {
    return error;
  }
  throw new Error('No lanzó ningún error');
}

const expected = (errorCode: string) =>
  expect.objectContaining({ errorCode, message: MESSAGES[errorCode] });

describe('readReservationListQuery (C1, "Orden de validación")', () => {
  describe('consultas válidas', () => {
    it('sin parámetros: todos los estados y canales, sin rango, de la más reciente y la página 1', () => {
      expect(readReservationListQuery({})).toEqual({
        search: null,
        status: null,
        source: null,
        otaId: null,
        inConflict: false,
        stayRange: null,
        order: 'desc',
        page: 1,
      });
    });

    it('con todos los filtros válidos los devuelve', () => {
      expect(
        readReservationListQuery({
          search: 'RSV-3F9A1C7B',
          status: 'ACTIVE',
          source: 'OTA',
          otaId: OTA_ID,
          inConflict: 'true',
          dateFrom: '2026-10-02',
          dateTo: '2026-10-06',
          order: 'asc',
          page: '3',
        }),
      ).toEqual({
        search: 'RSV-3F9A1C7B',
        status: 'ACTIVE',
        source: 'OTA',
        otaId: OTA_ID,
        inConflict: true,
        stayRange: { dateFrom: '2026-10-02', dateTo: '2026-10-06' },
        order: 'asc',
        page: 3,
      });
    });

    it('ignora los parámetros que no son de C1', () => {
      expect(readReservationListQuery({ pageSize: '50' }).page).toBe(1);
    });
  });

  describe('search (paso 2 del algoritmo)', () => {
    it.each([
      ['un código de reserva', 'RSV-3F9A1C7B'],
      ['un código de la OTA', '4417829013'],
      ['un nombre con tildes y ñ', 'Ibáñez'],
      ['un documento con guion', '1144-093552'],
      ['40 caracteres', 'A'.repeat(40)],
    ])('acepta %s', (_, search) => {
      expect(readReservationListQuery({ search }).search).toBe(search);
    });

    it('quita los espacios de los extremos (paso 1)', () => {
      expect(readReservationListQuery({ search: '  gomez ' }).search).toBe(
        'gomez',
      );
    });

    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['con un espacio interno', 'Ana Pérez'],
      ['con un punto', '1.144.093'],
      ['con caracteres de una etiqueta', '<script>'],
      ['con comillas', "o'brien"],
      ['de 41 caracteres', 'A'.repeat(41)],
      ['repetido', ['RSV-3F9A1C7B', 'RSV-8D02E5A4']],
    ])('%s: INVALID_RESERVATION_CODE', (_, search) => {
      expect(errorOf({ search })).toEqual(expected('INVALID_RESERVATION_CODE'));
    });
  });

  describe('status', () => {
    it.each([
      'PENDING',
      'ACTIVE',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ])('acepta %s', (status) => {
      expect(readReservationListQuery({ status }).status).toBe(status);
    });

    it.each([
      ['en minúscula', 'active'],
      ['desconocido', 'CHECKED_IN'],
      ['vacío', ''],
      ['repetido', ['ACTIVE', 'PENDING']],
    ])('%s: INVALID_STATUS', (_, status) => {
      expect(errorOf({ status })).toEqual(expected('INVALID_STATUS'));
    });
  });

  describe('source', () => {
    it.each(['DIRECT', 'OTA'])('acepta %s', (source) => {
      expect(readReservationListQuery({ source }).source).toBe(source);
    });

    it.each([
      ['en minúscula', 'ota'],
      ['desconocido', 'BOOKING'],
      ['vacío', ''],
    ])('%s: INVALID_CHANNEL', (_, source) => {
      expect(errorOf({ source })).toEqual(expected('INVALID_CHANNEL'));
    });
  });

  describe('otaId (formato y canal)', () => {
    it('acepta un UUID, también en mayúsculas, con el canal OTA', () => {
      expect(
        readReservationListQuery({
          source: 'OTA',
          otaId: OTA_ID.toUpperCase(),
        }).otaId,
      ).toBe(OTA_ID.toUpperCase());
    });

    it.each([
      ['que no es un UUID', 'booking'],
      ['vacío', ''],
      ['repetido', [OTA_ID, OTA_ID]],
    ])('%s: INVALID_OTA_ID', (_, otaId) => {
      expect(errorOf({ source: 'OTA', otaId })).toEqual(
        expected('INVALID_OTA_ID'),
      );
    });

    it.each([
      ['sin canal', {}],
      ['con el canal DIRECT', { source: 'DIRECT' }],
    ])('%s: AGENCY_REQUIRES_OTA_CHANNEL', (_, channel) => {
      expect(errorOf({ ...channel, otaId: OTA_ID })).toEqual(
        expected('AGENCY_REQUIRES_OTA_CHANNEL'),
      );
    });

    it('el formato va antes que el canal', () => {
      expect(errorOf({ otaId: 'booking' })).toEqual(expected('INVALID_OTA_ID'));
    });
  });

  describe('inConflict', () => {
    it('true: solo las de Booking en conflicto', () => {
      expect(readReservationListQuery({ inConflict: 'true' }).inConflict).toBe(
        true,
      );
    });

    it.each([
      ['false', 'false'],
      ['1', '1'],
      ['TRUE', 'TRUE'],
      ['vacío', ''],
    ])('%s: INVALID_CONFLICT_FILTER', (_, inConflict) => {
      expect(errorOf({ inConflict })).toEqual(
        expected('INVALID_CONFLICT_FILTER'),
      );
    });
  });

  describe('fechas (formato, completitud, orden y 366 días)', () => {
    it('un solo día (dateFrom = dateTo)', () => {
      expect(
        readReservationListQuery({
          dateFrom: '2026-10-01',
          dateTo: '2026-10-01',
        }).stayRange,
      ).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-01' });
    });

    it('366 días contando los extremos es el máximo', () => {
      expect(
        readReservationListQuery({
          dateFrom: '2026-01-01',
          dateTo: '2027-01-01',
        }).stayRange,
      ).toEqual({ dateFrom: '2026-01-01', dateTo: '2027-01-01' });
    });

    it('367 días: DATE_RANGE_TOO_LARGE', () => {
      expect(errorOf({ dateFrom: '2026-01-01', dateTo: '2027-01-02' })).toEqual(
        expected('DATE_RANGE_TOO_LARGE'),
      );
    });

    it.each([
      ['un día que el mes no tiene', '2026-02-30', '2026-03-01'],
      ['el mes 13', '2026-10-01', '2026-13-01'],
      ['otro formato', '01/10/2026', '2026-10-31'],
      // `Date` la lee como el 1 de octubre: solo el formato la rechaza.
      ['solo año y mes', '2026-10', '2026-10-31'],
      ['vacía', '', '2026-10-31'],
      ['repetida', ['2026-10-01', '2026-10-02'], '2026-10-31'],
    ])('%s: INVALID_DATE', (_, dateFrom, dateTo) => {
      expect(errorOf({ dateFrom, dateTo })).toEqual(expected('INVALID_DATE'));
    });

    it.each([
      ['solo dateFrom', { dateFrom: '2026-10-01' }],
      ['solo dateTo', { dateTo: '2026-10-31' }],
    ])('%s: INCOMPLETE_DATE_RANGE', (_, dates) => {
      expect(errorOf(dates)).toEqual(expected('INCOMPLETE_DATE_RANGE'));
    });

    it('el formato va antes que la completitud: una sola fecha inválida es INVALID_DATE', () => {
      expect(errorOf({ dateFrom: '2026-02-30' })).toEqual(
        expected('INVALID_DATE'),
      );
    });

    it('dateFrom posterior a dateTo: INVALID_DATE_RANGE', () => {
      expect(errorOf({ dateFrom: '2026-10-06', dateTo: '2026-10-02' })).toEqual(
        expected('INVALID_DATE_RANGE'),
      );
    });

    it('el orden de las fechas va antes que los 366 días', () => {
      expect(errorOf({ dateFrom: '2028-01-01', dateTo: '2026-01-01' })).toEqual(
        expected('INVALID_DATE_RANGE'),
      );
    });
  });

  describe('order', () => {
    it.each(['asc', 'desc'] as const)('acepta %s', (order) => {
      expect(readReservationListQuery({ order }).order).toBe(order);
    });

    it.each([
      ['en mayúscula', 'ASC'],
      ['desconocido', 'newest'],
      ['vacío', ''],
    ])('%s: INVALID_SORT_ORDER', (_, order) => {
      expect(errorOf({ order })).toEqual(expected('INVALID_SORT_ORDER'));
    });
  });

  describe('page', () => {
    it.each([
      ['1', 1],
      ['25', 25],
    ])('acepta %s', (page, number) => {
      expect(readReservationListQuery({ page }).page).toBe(number);
    });

    it.each([
      ['cero', '0'],
      ['negativa', '-1'],
      ['decimal', '1.5'],
      ['1.0', '1.0'],
      ['texto', 'dos'],
      ['vacía', ''],
      ['más grande que un entero seguro', '9007199254740993'],
      ['repetida', ['1', '2']],
    ])('%s: INVALID_PAGE', (_, page) => {
      expect(errorOf({ page })).toEqual(expected('INVALID_PAGE'));
    });
  });

  describe('orden de validación: el primero que falla responde', () => {
    /** Todos los parámetros inválidos; cada prueba corrige uno más y responde el siguiente. */
    const allInvalid = {
      search: '<x>',
      status: 'X',
      source: 'X',
      otaId: 'X',
      inConflict: 'X',
      dateFrom: 'X',
      dateTo: 'X',
      order: 'X',
      page: 'X',
    };
    const steps: [Record<string, unknown>, string][] = [
      [{}, 'INVALID_RESERVATION_CODE'],
      [{ search: 'gomez' }, 'INVALID_STATUS'],
      [{ status: 'ACTIVE' }, 'INVALID_CHANNEL'],
      [{ source: 'DIRECT' }, 'INVALID_OTA_ID'],
      [{ otaId: OTA_ID }, 'AGENCY_REQUIRES_OTA_CHANNEL'],
      [{ source: 'OTA' }, 'INVALID_CONFLICT_FILTER'],
      [{ inConflict: 'true' }, 'INVALID_DATE'],
      [{ dateFrom: '2026-10-06', dateTo: '2026-10-02' }, 'INVALID_DATE_RANGE'],
      [{ dateFrom: '2026-10-02', dateTo: '2026-10-06' }, 'INVALID_SORT_ORDER'],
      [{ order: 'asc' }, 'INVALID_PAGE'],
    ];

    it.each(
      steps.map((_, index) => {
        const fixes = Object.assign(
          {},
          ...steps.slice(0, index + 1).map(([fix]) => fix),
        ) as Record<string, unknown>;
        return [steps[index][1], fixes] as const;
      }),
    )('responde %s', (errorCode, fixes) => {
      expect(errorOf({ ...allInvalid, ...fixes })).toEqual(expected(errorCode));
    });

    it('con todo corregido, no hay error', () => {
      const fixes = Object.assign({}, ...steps.map(([fix]) => fix)) as Record<
        string,
        unknown
      >;
      expect(() =>
        readReservationListQuery({ ...allInvalid, ...fixes, page: '1' }),
      ).not.toThrow();
    });
  });
});
