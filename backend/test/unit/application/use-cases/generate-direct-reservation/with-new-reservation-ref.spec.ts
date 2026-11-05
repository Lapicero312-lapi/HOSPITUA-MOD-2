import { describe, expect, it, vi } from 'vitest';
import { DuplicateReservationRefError } from '../../../../../src/application/ports/out/reservation.repository.js';
import {
  MAX_REFERENCE_ATTEMPTS,
  withNewReservationRef,
} from '../../../../../src/application/use-cases/generate-direct-reservation/with-new-reservation-ref.js';

/** Un generador que entrega `RSV-00000001`, `RSV-00000002`… para saber con cuál se guardó. */
function sequentialRefs() {
  let n = 0;
  return () => `RSV-${String((n += 1)).padStart(8, '0')}`;
}

describe('withNewReservationRef', () => {
  it('guarda con la primera referencia si no existe', async () => {
    const save = vi.fn((ref: string) => Promise.resolve(ref));

    expect(await withNewReservationRef(save, sequentialRefs())).toBe(
      'RSV-00000001',
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('si la referencia ya existe, prueba con otra (plan, regla 7)', async () => {
    const save = vi.fn((ref: string) =>
      ref === 'RSV-00000001'
        ? Promise.reject(new DuplicateReservationRefError(ref))
        : Promise.resolve(ref),
    );

    expect(await withNewReservationRef(save, sequentialRefs())).toBe(
      'RSV-00000002',
    );
    expect(save.mock.calls.map(([ref]) => ref)).toEqual([
      'RSV-00000001',
      'RSV-00000002',
    ]);
  });

  it('el quinto intento todavía puede guardar', async () => {
    const save = vi.fn((ref: string) =>
      ref === 'RSV-00000005'
        ? Promise.resolve(ref)
        : Promise.reject(new DuplicateReservationRefError(ref)),
    );

    expect(await withNewReservationRef(save, sequentialRefs())).toBe(
      'RSV-00000005',
    );
  });

  it('se rinde a los 5 intentos y deja salir el último error', async () => {
    const save = vi.fn((ref: string) =>
      Promise.reject(new DuplicateReservationRefError(ref)),
    );

    await expect(
      withNewReservationRef(save, sequentialRefs()),
    ).rejects.toMatchObject({ reservationRef: 'RSV-00000005' });
    expect(save).toHaveBeenCalledTimes(MAX_REFERENCE_ATTEMPTS);
    expect(MAX_REFERENCE_ATTEMPTS).toBe(5);
  });

  it('otro error sale enseguida, sin reintentar', async () => {
    const other = new Error('otro error');
    const save = vi.fn(() => Promise.reject(other));

    await expect(withNewReservationRef(save, sequentialRefs())).rejects.toBe(
      other,
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('sin generador propio, usa referencias al azar con la forma del diccionario', async () => {
    const ref = await withNewReservationRef((r) => Promise.resolve(r));

    expect(ref).toMatch(/^RSV-[0-9A-F]{8}$/);
  });
});
