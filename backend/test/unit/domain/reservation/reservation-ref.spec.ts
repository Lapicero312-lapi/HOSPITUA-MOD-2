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

  // Con 100 hay 1 en unas 870 000 corridas de que se repitan por azar; con 1000 sería 1 en unas 8600, y
  // la prueba fallaría a veces sin que el código esté mal.
  it('es al azar: 100 referencias seguidas no se repiten', () => {
    const refs = new Set(Array.from({ length: 100 }, newReservationRef));

    expect(refs.size).toBe(100);
  });

  it('usa todos los caracteres hexadecimales, no solo los dígitos', () => {
    const seen = new Set(
      Array.from({ length: 1000 }, () => newReservationRef().slice(4)).join(''),
    );

    expect([...'0123456789ABCDEF'].every((c) => seen.has(c))).toBe(true);
  });
});
