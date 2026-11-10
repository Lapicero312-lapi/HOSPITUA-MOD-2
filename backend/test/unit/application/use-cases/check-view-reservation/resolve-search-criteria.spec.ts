import { describe, expect, it } from 'vitest';
import { resolveSearchCriteria } from '../../../../../src/application/use-cases/check-view-reservation/resolve-search-criteria.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';

/** El código del error de negocio con el que falla `resolveSearchCriteria(search)`. */
function errorOf(search: string): { errorCode: string; message: string } {
  try {
    resolveSearchCriteria(search);
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    const { errorCode, message } = error as BusinessError;
    return { errorCode, message };
  }
  throw new Error(`"${search}" no falló`);
}

const INVALID_CODE = {
  errorCode: 'INVALID_RESERVATION_CODE',
  message: 'Debe proveer un código de reserva válido para la consulta.',
};

describe('resolveSearchCriteria (plan de check-view-reservation, "Algoritmo de búsqueda"; T006)', () => {
  describe('paso 1: quita los espacios de los extremos', () => {
    it.each([
      [
        'un documento',
        '  1144093552  ',
        {
          code: '1144093552',
          fallback: { kind: 'DOCUMENT', documentNumber: '1144093552' },
        },
      ],
      [
        'un nombre',
        ' Gómez ',
        { code: 'Gómez', fallback: { kind: 'NAME', name: 'Gómez' } },
      ],
      [
        'la referencia interna',
        ' RSV-3F9A1C7B ',
        { code: 'RSV-3F9A1C7B', fallback: { kind: 'NOT_FOUND' } },
      ],
    ])(
      'con %s, el código y el criterio van sin ellos',
      (_, search, expected) => {
        expect(resolveSearchCriteria(search)).toEqual(expected);
      },
    );
  });

  describe('paso 2: formato, si no INVALID_RESERVATION_CODE', () => {
    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['con un espacio interno', 'Ana Pérez'],
      ['con una tabulación interna', 'Ana\tPérez'],
      ['con un apóstrofo', "O'Neil"],
      ['con un punto', 'ana.perez'],
      ['con un guion bajo', 'RSV_3F9A1C7B'],
      ['con una arroba', 'ana@correo.com'],
      ['con inyección', "' OR 1=1 --"],
      ['con un comodín de LIKE', 'Pé%rez'],
      ['con más de 40 caracteres', 'A'.repeat(41)],
      ['con una letra fuera del español', 'Çelik'],
    ])('%s', (_, search) => {
      expect(errorOf(search)).toEqual(INVALID_CODE);
    });

    it('acepta 40 caracteres justos', () => {
      expect(resolveSearchCriteria('A'.repeat(40)).code).toBe('A'.repeat(40));
    });

    it('acepta letras con tildes, la ñ y la ü, en mayúscula y minúscula, y el guion', () => {
      expect(resolveSearchCriteria('ÁÉÍÓÚÜÑáéíóúüñ-Ana').fallback).toEqual({
        kind: 'NAME',
        name: 'ÁÉÍÓÚÜÑáéíóúüñ-Ana',
      });
    });
  });

  describe('paso 4: la referencia interna sin coincidencia es NOT_FOUND', () => {
    it.each([
      ['en mayúscula', 'RSV-3F9A1C7B'],
      ['en minúscula', 'rsv-3f9a1c7b'],
      ['mezclada', 'Rsv-3F9a1C7b'],
      ['con otro largo', 'RSV-12'],
    ])('%s', (_, search) => {
      expect(resolveSearchCriteria(search)).toEqual({
        code: search,
        fallback: { kind: 'NOT_FOUND' },
      });
    });

    it('va antes que el paso 6: RSV- sin dígitos ni largo suficiente no es una búsqueda por nombre', () => {
      expect(resolveSearchCriteria('RSV-').fallback).toEqual({
        kind: 'NOT_FOUND',
      });
      expect(resolveSearchCriteria('rsv-ab').fallback).toEqual({
        kind: 'NOT_FOUND',
      });
    });

    it('RSV sin el guion no es la referencia interna', () => {
      expect(resolveSearchCriteria('RSV').fallback).toEqual({
        kind: 'NAME',
        name: 'RSV',
      });
    });

    it('RSV- en medio del texto no es la referencia interna: el paso 4 pide que empiece con RSV-', () => {
      expect(resolveSearchCriteria('AB-RSV-CD').fallback).toEqual({
        kind: 'NAME',
        name: 'AB-RSV-CD',
      });
    });
  });

  describe('paso 5: con al menos un dígito, un número de documento exacto', () => {
    it.each([
      ['solo dígitos', '1144093552'],
      ['un pasaporte con letras', 'X99'],
      ['un solo dígito', '7'],
      ['un código de la OTA', '4417829013'],
      ['con guion', 'AB-12'],
    ])('%s', (_, search) => {
      expect(resolveSearchCriteria(search)).toEqual({
        code: search,
        fallback: { kind: 'DOCUMENT', documentNumber: search },
      });
    });
  });

  describe('paso 6: sin dígitos, un nombre de al menos 3 caracteres', () => {
    it.each([
      ['tres letras', 'Ana'],
      ['un apellido con tilde', 'Gómez'],
      ['en minúscula y sin tilde', 'gomez'],
    ])('%s', (_, search) => {
      expect(resolveSearchCriteria(search)).toEqual({
        code: search,
        fallback: { kind: 'NAME', name: search },
      });
    });

    it.each([
      ['una letra', 'A'],
      ['dos letras', 'Al'],
      ['dos letras con espacios alrededor', '  Al  '],
      ['un guion y una letra', '-a'],
    ])('con %s: NAME_SEARCH_TOO_SHORT', (_, search) => {
      expect(errorOf(search)).toEqual({
        errorCode: 'NAME_SEARCH_TOO_SHORT',
        message: 'La búsqueda por nombre requiere al menos 3 caracteres.',
      });
    });
  });

  it('el código conserva las mayúsculas tal como llegaron: la coincidencia del paso 3 no las distingue', () => {
    expect(resolveSearchCriteria('rsV-3f9a1C7B').code).toBe('rsV-3f9a1C7B');
  });
});
