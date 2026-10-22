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
