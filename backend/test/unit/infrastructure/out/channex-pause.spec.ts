import { describe, expect, it } from 'vitest';
import { ChannexPause } from '../../../../src/infrastructure/out/channex/channex-pause.js';

const MINUTE = 60_000;

/** Una pausa con un reloj que la prueba adelanta a mano. */
function pauseWithClock() {
  let now = 0;
  const pause = new ChannexPause(() => now);
  return {
    pause,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Cuánto dura la pausa que arranca ahora. */
function pauseLength(
  pause: ChannexPause,
  advance: (ms: number) => void,
): number {
  let elapsed = 0;
  while (pause.isActive()) {
    advance(1_000);
    elapsed += 1_000;
  }
  return elapsed;
}

describe('ChannexPause', () => {
  it('sin 429 las llamadas salen', () => {
    expect(new ChannexPause(() => 0).isActive()).toBe(false);
  });

  it('un 429 pausa las llamadas 1 minuto', () => {
    const { pause, advance } = pauseWithClock();

    pause.rateLimited();

    expect(pause.isActive()).toBe(true);
    advance(MINUTE - 1);
    expect(pause.isActive()).toBe(true);
    advance(1);
    expect(pause.isActive()).toBe(false);
  });

  it('cada 429 seguido duplica la pausa: 1, 2, 4 y 8 minutos, con un tope de 10', () => {
    const { pause, advance } = pauseWithClock();
    const lengths = [];

    for (let i = 0; i < 6; i++) {
      pause.rateLimited();
      lengths.push(pauseLength(pause, advance) / MINUTE);
    }

    expect(lengths).toEqual([1, 2, 4, 8, 10, 10]);
  });

  it('una respuesta que no es 429 vuelve la próxima pausa a 1 minuto', () => {
    const { pause, advance } = pauseWithClock();
    pause.rateLimited();
    pauseLength(pause, advance);
    pause.rateLimited();
    pauseLength(pause, advance);

    pause.answered();
    pause.rateLimited();

    expect(pauseLength(pause, advance)).toBe(MINUTE);
  });
});
