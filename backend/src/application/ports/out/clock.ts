/** Símbolo con el que Nest inyecta el reloj: `@Inject(CLOCK) clock: Clock` (plan base, regla 4). */
export const CLOCK = Symbol('CLOCK');

/**
 * Reloj del hotel: el día operativo en Colombia (de 00:00 a 23:59; la zona horaria de Colombia es
 * `America/Bogota`) y el instante actual.
 */
export interface Clock {
  /** Día operativo en curso, como `AAAA-MM-DD`. */
  today(): string;

  /** Instante exacto en que se consulta. */
  now(): Date;
}
