import { describe, expect, it } from 'vitest';
import { aGuest } from '../../../support/builders.js';

describe('Guest', () => {
  it('el nombre completo une nombres y apellidos', () => {
    expect(
      aGuest({ firstName: 'María José', lastName: 'Gómez' }).fullName,
    ).toBe('María José Gómez');
  });

  it('un titular de Booking puede no tener documento ni nacionalidad', () => {
    const guest = aGuest({
      documentType: null,
      documentNumber: null,
      nationality: null,
    });

    expect(guest.documentType).toBeNull();
    expect(guest.documentNumber).toBeNull();
  });

  it.each([
    ['sin nombres', { firstName: '  ' }],
    ['sin apellidos', { lastName: '' }],
    ['con tipo de documento y sin número', { documentNumber: null }],
    ['con número de documento y sin tipo', { documentType: null }],
  ])('se rechaza %s', (_, changes) => {
    expect(() => aGuest(changes)).toThrow(
      expect.objectContaining({
        errorCode: 'GUEST_DATA_REQUIRED',
        message: 'Los datos del titular son obligatorios.',
      }),
    );
  });
});
