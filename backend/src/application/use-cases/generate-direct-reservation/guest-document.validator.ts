import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  DOCUMENT_TYPES,
  type DocumentType,
} from '../../../domain/shared/enums.js';
import {
  GUEST_DATA_REQUIRED,
  INVALID_CHARACTERS,
  INVALID_DOCUMENT_TYPE,
} from '../../../domain/shared/error-codes.js';

/**
 * Letras, dígitos y guion: los caracteres de la búsqueda por documento de `check-view-reservation`. Las
 * letras incluyen las tildes y la `ñ`.
 */
const DOCUMENT_NUMBER_CHARACTERS = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]+$/;

/** El documento de un titular, ya revisado. */
export type GuestDocument = {
  documentType: DocumentType;
  documentNumber: string;
};

/**
 * Revisa el tipo y el número de documento tal como llegan en la consulta (plan, punto 9): sin los espacios
 * de los extremos y en este orden, el primero que falla da el error.
 * @throws BusinessError `GUEST_DATA_REQUIRED` si falta uno de los dos o llega vacío,
 * `INVALID_DOCUMENT_TYPE` si el tipo no es uno de los seis, o `INVALID_CHARACTERS` si el número trae algo
 * distinto de letras, dígitos y guion. Un parámetro repetido llega como lista: cuenta como valor no válido.
 */
export function readGuestDocument(
  documentType: unknown,
  documentNumber: unknown,
): GuestDocument {
  const type = trimmed(documentType);
  const number = trimmed(documentNumber);
  if (isMissing(type) || isMissing(number)) {
    throw new BusinessError(
      GUEST_DATA_REQUIRED.code,
      GUEST_DATA_REQUIRED.message,
    );
  }
  if (!isDocumentType(type)) {
    throw new BusinessError(
      INVALID_DOCUMENT_TYPE.code,
      INVALID_DOCUMENT_TYPE.message,
    );
  }
  if (typeof number !== 'string' || !DOCUMENT_NUMBER_CHARACTERS.test(number)) {
    throw new BusinessError(
      INVALID_CHARACTERS.code,
      INVALID_CHARACTERS.message,
    );
  }
  return { documentType: type, documentNumber: number };
}

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === '';
}

function isDocumentType(value: unknown): value is DocumentType {
  return (DOCUMENT_TYPES as readonly unknown[]).includes(value);
}
