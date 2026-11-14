/** La pausa tras cada 429 seguido: 1 minuto, después 2, 4 y 8, con un tope de 10 (plan base). */
export const PAUSE_STEPS_MS = [60_000, 120_000, 240_000, 480_000, 600_000];

/**
 * La pausa de las llamadas a Channex de la propiedad ante un 429 (plan base, "`ChannexPort`"). Vive en la
 * memoria del proceso: el Módulo 2 corre en una sola instancia.
 */
export class ChannexPause {
  private pausedUntil = 0;
  private consecutive = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Si las llamadas todavía no pueden salir a Channex. */
  isActive(): boolean {
    return this.now() < this.pausedUntil;
  }

  /** Channex respondió 429: pausa, más larga si el 429 anterior no tuvo otra respuesta en medio. */
  rateLimited(): void {
    const step =
      PAUSE_STEPS_MS[Math.min(this.consecutive, PAUSE_STEPS_MS.length - 1)];
    this.pausedUntil = this.now() + step;
    this.consecutive++;
  }

  /** Channex respondió algo que no es 429: la próxima pausa vuelve a ser de 1 minuto. */
  answered(): void {
    this.consecutive = 0;
  }
}
