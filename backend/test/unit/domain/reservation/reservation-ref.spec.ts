import { describe, expect, it } from 'vitest';
import { newReservationRef } from '../../../../src/domain/reservation/reservation-ref.js';

/** Diccionario: "`RSV-` seguido de 8 caracteres hexadecimales en mayúscula", por ejemplo `RSV-3F9A1C7B`. */
const FORMAT = /^RSV-[0-9A-F]{8}$/;

describe('newReservationRef', () => {
  it('tiene la forma del diccionario', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(newReservationRef()).toMatch(FORMAT);
    }
  });

  it('es al azar: 1000 referencias seguidas no se repiten', () => {
    const refs = new Set(Array.from({ length: 1000 }, newReservationRef));

    expect(refs.size).toBe(1000);
  });

  it('usa todos los caracteres hexadecimales, no solo los dígitos', () => {
    const seen = new Set(
      Array.from({ length: 1000 }, newReservationRef).join('').slice(4),
    );

    expect([...'0123456789ABCDEF'].every((c) => seen.has(c))).toBe(true);
  });
});
