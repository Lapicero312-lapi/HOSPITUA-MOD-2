/** Reloj del hotel: el día operativo (00:00–23:59 en `America/Bogota`) y el instante actual. */
export interface Clock {
  /** Día operativo en curso, como `AAAA-MM-DD`. */
  today(): string;

  /** Instante exacto en que se consulta. */
  now(): Date;
}
