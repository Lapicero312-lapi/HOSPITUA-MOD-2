import { describe, expect, it } from 'vitest';
import { readGuestDocument } from '../../../../../src/application/use-cases/generate-direct-reservation/guest-document.validator.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';

function errorOf(
  documentType: unknown,
  documentNumber: unknown,
): BusinessError {
  try {
    readGuestDocument(documentType, documentNumber);
  } catch (error) {
    if (error instanceof BusinessError) {
      return error;
    }
    throw error;
  }
  throw new Error('No lanzó ningún error');
}

describe('readGuestDocument (plan, punto 9)', () => {
  it('con CC 123 (escenario 10) devuelve el documento', () => {
    expect(readGuestDocument('CC', '123')).toEqual({
      documentType: 'CC',
      documentNumber: '123',
    });
  });

  it.each(['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'])(
    'acepta el tipo %s',
    (type) => {
      expect(readGuestDocument(type, '123').documentType).toBe(type);
    },
  );

  it('quita los espacios de los extremos de los dos', () => {
    expect(readGuestDocument('  PAS ', ' AB-123456 ')).toEqual({
      documentType: 'PAS',
      documentNumber: 'AB-123456',
    });
  });

  it('acepta letras con tilde y ñ, dígitos y guion en el número', () => {
    expect(readGuestDocument('PAS', 'ÑÁéü-09').documentNumber).toBe('ÑÁéü-09');
  });

  describe('GUEST_DATA_REQUIRED: falta uno de los dos o llega vacío', () => {
    it.each<[string, unknown, unknown]>([
      ['sin tipo', undefined, '123'],
      ['sin número', 'CC', undefined],
      ['sin ninguno', undefined, undefined],
      ['tipo vacío', '', '123'],
      ['número con solo espacios', 'CC', '   '],
    ])('%s', (_caso, documentType, documentNumber) => {
      expect(errorOf(documentType, documentNumber)).toMatchObject({
        errorCode: 'GUEST_DATA_REQUIRED',
        message: 'Los datos del titular son obligatorios.',
      });
    });

    it('va antes que el tipo no válido', () => {
      expect(errorOf('XX', '').errorCode).toBe('GUEST_DATA_REQUIRED');
    });
  });

  describe('INVALID_DOCUMENT_TYPE: el tipo no es uno de los seis', () => {
    it.each<[string, unknown]>([
      ['otro tipo', 'DNI'],
      ['en minúscula', 'cc'],
      ['repetido', ['CC', 'TI']],
    ])('%s', (_caso, documentType) => {
      expect(errorOf(documentType, '123')).toMatchObject({
        errorCode: 'INVALID_DOCUMENT_TYPE',
        message: 'El tipo de documento no es válido.',
      });
    });

    it('va antes que los caracteres no válidos', () => {
      expect(errorOf('DNI', '12.3').errorCode).toBe('INVALID_DOCUMENT_TYPE');
    });
  });

  describe('INVALID_CHARACTERS: el número trae algo distinto de letras, dígitos y guion', () => {
    it.each<[string, unknown]>([
      ['punto', '1.144.093.552'],
      ['espacio interno', '114 409'],
      ['comilla', "123'--"],
      ['etiqueta', '<b>123</b>'],
      ['repetido', ['123', '456']],
      // `documentNumber[]=123`: una lista de un solo valor válido tampoco es texto.
      ['como lista', ['123']],
    ])('%s', (_caso, documentNumber) => {
      expect(errorOf('CC', documentNumber)).toMatchObject({
        errorCode: 'INVALID_CHARACTERS',
        message: 'El formato de los datos contiene caracteres no válidos.',
      });
    });
  });
});
