import { describe, expect, it } from 'vitest';
import { isForeign } from '../../../../src/domain/migration/is-foreign.js';

/** Plan de `process-guest-data`, punto 8: "comparación exacta; una vacía no es extranjera". */
describe('isForeign', () => {
  it('un colombiano no es extranjero', () => {
    expect(isForeign('Colombia')).toBe(false);
  });

  it.each(['Venezuela', 'Estados Unidos'])(
    '%s es extranjero',
    (nationality) => {
      expect(isForeign(nationality)).toBe(true);
    },
  );

  it('una nacionalidad vacía no es extranjera', () => {
    expect(isForeign('')).toBe(false);
  });

  it('la comparación es exacta: "colombia" en minúscula cuenta como extranjero', () => {
    expect(isForeign('colombia')).toBe(true);
  });
});
