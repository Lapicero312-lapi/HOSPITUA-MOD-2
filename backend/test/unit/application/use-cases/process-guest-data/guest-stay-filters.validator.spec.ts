import { describe, expect, it } from 'vitest';
import {
  readGuestStayFilters,
  readGuestStayKey,
  type GuestStayQueryParams,
} from '../../../../../src/application/use-cases/process-guest-data/guest-stay-filters.validator.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';

function errorOf(read: () => unknown): { errorCode: string; message: string } {
  try {
    read();
  } catch (error) {
    if (error instanceof BusinessError) {
      return { errorCode: error.errorCode, message: error.message };
    }
    throw error;
  }
  throw new Error('No lanzó ningún error');
}

const filtersError = (params: GuestStayQueryParams) =>
  errorOf(() => readGuestStayFilters(params));

/** Los mensajes literales de la tabla de errores de C1 y de C2 del plan. */
const ERRORS = {
  INVALID_NATIONALITY_FILTER: 'El filtro de nacionalidad no es válido.',
  INVALID_PRESENCE_FILTER: 'El filtro de situación no es válido.',
  INVALID_DATE: 'La fecha indicada no es válida.',
  INCOMPLETE_DATE_RANGE: 'Debe completar ambas fechas del rango.',
  INVALID_DATE_RANGE:
    'La fecha inicial no puede ser posterior a la fecha final.',
  DATE_RANGE_TOO_LARGE: 'El rango de fechas no puede superar 366 días.',
  NAME_SEARCH_TOO_SHORT:
    'La búsqueda por nombre requiere al menos 3 caracteres.',
  INVALID_SEARCH: 'La búsqueda no es válida.',
  INVALID_PAGE: 'El número de página debe ser 1 o mayor.',
  INVALID_RESERVATION_CODE:
    'Debe proveer un código de reserva válido para la consulta.',
  INVALID_DOCUMENT_NUMBER: 'El número de documento no es válido.',
} as const;

const expected = (errorCode: keyof typeof ERRORS) => ({
  errorCode,
  message: ERRORS[errorCode],
});

describe('readGuestStayFilters (C1)', () => {
  it('sin parámetros: todos, sin fechas ni búsqueda, página 1', () => {
    expect(readGuestStayFilters({})).toEqual({
      nationality: 'ALL',
      presence: 'ALL',
      dateRange: null,
      search: null,
      page: 1,
    });
  });

  it('con todos los filtros válidos los devuelve', () => {
    expect(
      readGuestStayFilters({
        nationality: 'FOREIGN',
        presence: 'IN_HOTEL',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        search: 'X99',
        page: '3',
      }),
    ).toEqual({
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateRange: { dateFrom: '2026-10-01', dateTo: '2026-10-31' },
      search: { kind: 'DOCUMENT', documentNumber: 'X99' },
      page: 3,
    });
  });

  describe('nacionalidad', () => {
    it.each(['ALL', 'FOREIGN', 'COLOMBIAN'])('acepta %s', (nationality) => {
      expect(readGuestStayFilters({ nationality }).nationality).toBe(
        nationality,
      );
    });

    it.each<[string, unknown]>([
      ['otro valor', 'EXTRANJERO'],
      ['en minúscula', 'foreign'],
      ['vacía', ''],
      ['repetida', ['ALL', 'FOREIGN']],
    ])('%s: INVALID_NATIONALITY_FILTER', (_caso, nationality) => {
      expect(filtersError({ nationality })).toEqual(
        expected('INVALID_NATIONALITY_FILTER'),
      );
    });
  });

  describe('situación', () => {
    it.each(['ALL', 'IN_HOTEL', 'CHECKED_OUT'])('acepta %s', (presence) => {
      expect(readGuestStayFilters({ presence }).presence).toBe(presence);
    });

    it.each<[string, unknown]>([
      ['otro valor', 'EN_HOTEL'],
      ['vacía', ''],
      ['repetida', ['IN_HOTEL', 'CHECKED_OUT']],
    ])('%s: INVALID_PRESENCE_FILTER', (_caso, presence) => {
      expect(filtersError({ presence })).toEqual(
        expected('INVALID_PRESENCE_FILTER'),
      );
    });
  });

  describe('fechas', () => {
    it('un solo día (dateFrom igual a dateTo)', () => {
      expect(
        readGuestStayFilters({ dateFrom: '2026-10-09', dateTo: '2026-10-09' })
          .dateRange,
      ).toEqual({ dateFrom: '2026-10-09', dateTo: '2026-10-09' });
    });

    it('366 días contando los dos extremos es el máximo', () => {
      expect(
        readGuestStayFilters({ dateFrom: '2026-01-01', dateTo: '2027-01-01' })
          .dateRange,
      ).toEqual({ dateFrom: '2026-01-01', dateTo: '2027-01-01' });
    });

    it('367 días: DATE_RANGE_TOO_LARGE', () => {
      expect(
        filtersError({ dateFrom: '2026-01-01', dateTo: '2027-01-02' }),
      ).toEqual(expected('DATE_RANGE_TOO_LARGE'));
    });

    it.each<[string, GuestStayQueryParams]>([
      ['solo dateFrom', { dateFrom: '2026-10-01' }],
      ['solo dateTo', { dateTo: '2026-10-31' }],
    ])('%s: INCOMPLETE_DATE_RANGE', (_caso, params) => {
      expect(filtersError(params)).toEqual(expected('INCOMPLETE_DATE_RANGE'));
    });

    it.each<[string, unknown, unknown]>([
      ['un día que el mes no tiene', '2026-02-30', '2026-03-01'],
      ['el mes 13', '2026-10-01', '2026-13-01'],
      ['otro formato', '01/10/2026', '2026-10-31'],
      ['vacía', '', '2026-10-31'],
      ['repetida', ['2026-10-01', '2026-10-02'], '2026-10-31'],
    ])('%s: INVALID_DATE', (_caso, dateFrom, dateTo) => {
      expect(filtersError({ dateFrom, dateTo })).toEqual(
        expected('INVALID_DATE'),
      );
    });

    it('dateFrom posterior a dateTo: INVALID_DATE_RANGE', () => {
      expect(
        filtersError({ dateFrom: '2026-10-31', dateTo: '2026-10-01' }),
      ).toEqual(expected('INVALID_DATE_RANGE'));
    });
  });

  describe('búsqueda', () => {
    it.each([
      ['un documento con letras y dígitos', 'X99'],
      ['un documento con guion', 'AB-123456'],
      ['un solo dígito', '7'],
    ])('con algún dígito es un documento exacto: %s', (_caso, search) => {
      expect(readGuestStayFilters({ search }).search).toEqual({
        kind: 'DOCUMENT',
        documentNumber: search,
      });
    });

    it.each([
      ['un apellido', 'Smith'],
      ['con tilde y ñ', 'Núñez'],
      ['tres letras', 'Ana'],
    ])('sin dígitos es un nombre: %s', (_caso, search) => {
      expect(readGuestStayFilters({ search }).search).toEqual({
        kind: 'NAME',
        text: search,
      });
    });

    it('quita los espacios de los extremos', () => {
      expect(readGuestStayFilters({ search: '  X99 ' }).search).toEqual({
        kind: 'DOCUMENT',
        documentNumber: 'X99',
      });
    });

    it.each(['al', 'J', ' Jo '])(
      'un nombre de menos de 3 caracteres (%s): NAME_SEARCH_TOO_SHORT',
      (search) => {
        expect(filtersError({ search })).toEqual(
          expected('NAME_SEARCH_TOO_SHORT'),
        );
      },
    );

    it.each<[string, unknown]>([
      ['vacía', ''],
      ['solo espacios', '   '],
      ['con un espacio interno', 'John Smith'],
      ['con un punto', '1.144'],
      ['con una comilla', "O'Brien"],
      ['con una etiqueta', '<b>'],
      ['repetida', ['X99', 'Y88']],
    ])('%s: INVALID_SEARCH', (_caso, search) => {
      expect(filtersError({ search })).toEqual(expected('INVALID_SEARCH'));
    });

    it('los caracteres no válidos van antes que el largo del nombre', () => {
      expect(filtersError({ search: '<a' })).toEqual(
        expected('INVALID_SEARCH'),
      );
    });
  });

  describe('página', () => {
    it.each([
      ['1', 1],
      ['25', 25],
    ])('acepta %s', (page, value) => {
      expect(readGuestStayFilters({ page }).page).toBe(value);
    });

    it.each<[string, unknown]>([
      ['cero', '0'],
      ['negativa', '-1'],
      ['decimal', '1.5'],
      ['con punto decimal', '1.0'],
      ['texto', 'dos'],
      ['vacía', ''],
      ['más grande que un entero seguro', '9007199254740993'],
      ['repetida', ['1', '2']],
    ])('%s: INVALID_PAGE', (_caso, page) => {
      expect(filtersError({ page })).toEqual(expected('INVALID_PAGE'));
    });
  });

  describe('orden de la tabla de errores: el primero que falla responde', () => {
    const allInvalid: GuestStayQueryParams = {
      nationality: 'X',
      presence: 'X',
      dateFrom: '2026-10-01',
      search: '',
      page: '0',
    };

    it('la nacionalidad primero', () => {
      expect(filtersError(allInvalid)).toEqual(
        expected('INVALID_NATIONALITY_FILTER'),
      );
    });

    it('después la situación', () => {
      expect(filtersError({ ...allInvalid, nationality: 'ALL' })).toEqual(
        expected('INVALID_PRESENCE_FILTER'),
      );
    });

    it('después las fechas', () => {
      expect(
        filtersError({ ...allInvalid, nationality: 'ALL', presence: 'ALL' }),
      ).toEqual(expected('INCOMPLETE_DATE_RANGE'));
    });

    it('después la búsqueda', () => {
      expect(
        filtersError({
          ...allInvalid,
          nationality: 'ALL',
          presence: 'ALL',
          dateFrom: undefined,
        }),
      ).toEqual(expected('INVALID_SEARCH'));
    });

    it('y al final la página', () => {
      expect(
        filtersError({
          ...allInvalid,
          nationality: 'ALL',
          presence: 'ALL',
          dateFrom: undefined,
          search: undefined,
        }),
      ).toEqual(expected('INVALID_PAGE'));
    });
  });
});

describe('readGuestStayKey (C2)', () => {
  it('con una referencia y un documento válidos los devuelve', () => {
    expect(readGuestStayKey('RSV-3F9A1C7B', 'X99')).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      documentNumber: 'X99',
    });
  });

  it.each<[string, unknown]>([
    ['en minúscula', 'rsv-3f9a1c7b'],
    ['con 7 hexadecimales', 'RSV-3F9A1C7'],
    ['sin el prefijo', '3F9A1C7B'],
    ['vacía', ''],
    ['ausente', undefined],
  ])('referencia %s: INVALID_RESERVATION_CODE', (_caso, reservationRef) => {
    expect(errorOf(() => readGuestStayKey(reservationRef, 'X99'))).toEqual(
      expected('INVALID_RESERVATION_CODE'),
    );
  });

  it.each<[string, unknown]>([
    ['vacío', ''],
    ['con un espacio', 'X 99'],
    ['con un punto', '1.144'],
    ['con una etiqueta', '<b>'],
    ['ausente', undefined],
  ])('documento %s: INVALID_DOCUMENT_NUMBER', (_caso, documentNumber) => {
    expect(
      errorOf(() => readGuestStayKey('RSV-3F9A1C7B', documentNumber)),
    ).toEqual(expected('INVALID_DOCUMENT_NUMBER'));
  });

  it('la referencia se revisa antes que el documento', () => {
    expect(errorOf(() => readGuestStayKey('RSV-1', ''))).toEqual(
      expected('INVALID_RESERVATION_CODE'),
    );
  });

  it('acepta un documento con guion, tildes o ñ', () => {
    expect(readGuestStayKey('RSV-3F9A1C7B', 'Ñá-09').documentNumber).toBe(
      'Ñá-09',
    );
  });
});
