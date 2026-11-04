import { describe, expect, it } from 'vitest';
import { mapWithLimit } from '../../../../src/application/shared/map-with-limit.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Una función que cuenta cuántas llamadas hay en curso a la vez. Cada llamada tarda `delay(item)` ms, para
 * que puedan terminar en otro orden que el de los elementos.
 */
function tracking<T, R>(
  fn: (item: T) => Promise<R>,
  delay: (item: T) => number = () => 5,
) {
  const state = { running: 0, maxRunning: 0, calls: [] as T[] };
  const tracked = async (item: T) => {
    state.calls.push(item);
    state.running++;
    state.maxRunning = Math.max(state.maxRunning, state.running);
    try {
      await sleep(delay(item));
      return await fn(item);
    } finally {
      state.running--;
    }
  };
  return { tracked, state };
}

describe('mapWithLimit', () => {
  it('devuelve los resultados en el orden de los elementos, aunque terminen en otro orden', async () => {
    // La 3 tarda más que la 1 y la 2: termina última, pero su resultado va primero.
    const { tracked } = tracking(
      (n: number) => Promise.resolve(n * 10),
      (n) => n * 5,
    );

    await expect(mapWithLimit([3, 1, 2], 3, tracked)).resolves.toEqual([
      30, 10, 20,
    ]);
  });

  it.each([1, 2, 3])(
    'con tope %i nunca tiene más llamadas en curso que el tope',
    async (limit) => {
      const { tracked, state } = tracking((n: number) => Promise.resolve(n));

      await mapWithLimit([1, 2, 3, 4, 5, 6], limit, tracked);

      expect(state.maxRunning).toBe(limit);
      expect(state.calls).toHaveLength(6);
    },
  );

  it('sin elementos no llama a nada', async () => {
    const { tracked, state } = tracking((n: number) => Promise.resolve(n));

    await expect(mapWithLimit([], 3, tracked)).resolves.toEqual([]);
    expect(state.calls).toEqual([]);
  });

  it('si una llamada falla, se rechaza con ese error y no empieza ninguna más, aunque haya otras en curso', async () => {
    const failure = new Error('el Módulo 1 no responde');
    // La 1 falla enseguida; la 2 sigue en curso y, al terminar, no debe tomar la 3.
    const { tracked, state } = tracking(
      (n: number) => (n === 1 ? Promise.reject(failure) : Promise.resolve(n)),
      (n) => (n === 1 ? 0 : 10),
    );

    await expect(mapWithLimit([1, 2, 3, 4, 5], 2, tracked)).rejects.toBe(
      failure,
    );
    // Espera a que termine la 2, que estaba en curso.
    await sleep(40);
    expect(state.calls).toEqual([1, 2]);
  });
});
