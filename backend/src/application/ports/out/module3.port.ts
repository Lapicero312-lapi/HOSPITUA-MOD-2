import type { RateQuote } from '../../integration/rate-quote.js';

/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const MODULE3_PORT = Symbol('MODULE3_PORT');

/**
 * Lo que el Módulo 2 pide al Módulo 3 (plan base, regla 3). Los nombres de los parámetros son los de la
 * API del Módulo 3: `roomType` es la `categoryRoom`, y `checkInDate` y `checkOutDate` son la `startDate`
 * y la `endDate`.
 */
export interface Module3Port {
  /**
   * Una cotización para una habitación.
   * @throws Module3RejectedError o Module3UnavailableError.
   */
  createQuote(
    roomType: string,
    checkInDate: string,
    checkOutDate: string,
  ): Promise<RateQuote>;
}

/**
 * El Módulo 3 respondió con un 4xx que no es de disponibilidad (`400` o `404`): rechazó la categoría,
 * las fechas o los parámetros.
 */
export class Module3RejectedError extends Error {
  constructor(readonly status: number) {
    super(`El Módulo 3 rechazó la cotización (${status}).`);
  }
}

/**
 * El Módulo 3 no respondió a tiempo, no se pudo conectar, respondió 5xx, un error de disponibilidad
 * (`422` o `424`) u otro estado inesperado, o envió una cotización que no cumple el contrato. Nunca se
 * asume una tarifa, ni por defecto ni a cero.
 */
export class Module3UnavailableError extends Error {
  constructor(detail: string) {
    super(`El Módulo 3 no está disponible: ${detail}.`);
  }
}
