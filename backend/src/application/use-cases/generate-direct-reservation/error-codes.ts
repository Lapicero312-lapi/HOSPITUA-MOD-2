/**
 * Códigos de error que solo usa `generate-direct-reservation`, con los mensajes literales de la tabla C de
 * su plan. Los que comparte con otros casos de uso están en `domain/shared/error-codes.ts`. El resto de la
 * tabla C llega con la T006.
 * Se lanzan con `new BusinessError(INVALID_DOCUMENT_TYPE.code, INVALID_DOCUMENT_TYPE.message)`.
 */

/** `documentType` no es `RC`, `TI`, `CC`, `CE`, `PAS` ni `NIT`. */
export const INVALID_DOCUMENT_TYPE = {
  code: 'INVALID_DOCUMENT_TYPE',
  message: 'El tipo de documento no es válido.',
} as const;
