import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GuestData,
  type GuestDataProps,
} from '../../../../src/domain/migration/guest-data.js';

/** El huésped del ejemplo de C2 del plan de `process-guest-data`. */
const PROPS: GuestDataProps = {
  id: randomUUID(),
  reservationRef: 'RSV-3F9A1C7B',
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};

describe('GuestData', () => {
  it('conserva los datos con los que se crea', () => {
    const guest = GuestData.restore(PROPS);

    expect(guest.snapshot()).toEqual(PROPS);
    expect({
      id: guest.id,
      reservationRef: guest.reservationRef,
      firstName: guest.firstName,
      lastName: guest.lastName,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      birthDate: guest.birthDate,
      nationality: guest.nationality,
      originPlace: guest.originPlace,
      destinationPlace: guest.destinationPlace,
    }).toEqual(PROPS);
  });

  it('acepta un colombiano sin procedencia ni destino', () => {
    const guest = GuestData.restore({
      ...PROPS,
      nationality: 'Colombia',
      originPlace: null,
      destinationPlace: null,
    });

    expect(guest.originPlace).toBeNull();
    expect(guest.destinationPlace).toBeNull();
  });

  it('cambiar la copia no cambia el huésped', () => {
    const guest = GuestData.restore(PROPS);

    guest.snapshot().firstName = 'Otro';

    expect(guest.firstName).toBe('John');
  });
});
