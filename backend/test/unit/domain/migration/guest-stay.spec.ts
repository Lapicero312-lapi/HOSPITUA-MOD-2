import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GuestData } from '../../../../src/domain/migration/guest-data.js';
import { deriveGuestStay } from '../../../../src/domain/migration/guest-stay.js';
import { MigratoryMovement } from '../../../../src/domain/migration/migratory-movement.js';
import type { MovementType } from '../../../../src/domain/shared/enums.js';

/** El huésped y las fechas de los ejemplos de C1 y C2 del plan de `process-guest-data`. */
const GUEST = GuestData.restore({
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
});

const movement = (
  movementType: MovementType,
  movementDate: string,
  guestDataId = GUEST.id,
) =>
  MigratoryMovement.restore({
    id: randomUUID(),
    guestDataId,
    movementType,
    movementDate,
  });

const ENTRY = movement('ENTRY', '2026-10-09');
const DEPARTURE = movement('DEPARTURE', '2026-10-12');

describe('deriveGuestStay', () => {
  it('con entrada y sin salida está en el hotel: la fila del ejemplo de C1', () => {
    expect(deriveGuestStay(GUEST, [ENTRY])).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      guest: {
        firstName: 'John',
        lastName: 'Smith',
        documentType: 'PAS',
        documentNumber: 'X99',
        nationality: 'Estados Unidos',
        isForeign: true,
      },
      entryDate: '2026-10-09',
      exitDate: null,
      inHotel: true,
    });
  });

  it('con entrada y salida ya no está en el hotel', () => {
    expect(deriveGuestStay(GUEST, [ENTRY, DEPARTURE])).toMatchObject({
      entryDate: '2026-10-09',
      exitDate: '2026-10-12',
      inHotel: false,
    });
  });

  it('el orden de los movimientos no importa', () => {
    expect(deriveGuestStay(GUEST, [DEPARTURE, ENTRY])).toMatchObject({
      entryDate: '2026-10-09',
      exitDate: '2026-10-12',
      inHotel: false,
    });
  });

  it('solo con salida (DEPARTURE sin ENTRY) no tiene entrada y no está en el hotel', () => {
    expect(deriveGuestStay(GUEST, [DEPARTURE])).toMatchObject({
      entryDate: null,
      exitDate: '2026-10-12',
      inHotel: false,
    });
  });

  it('sin movimientos no tiene fechas ni está en el hotel', () => {
    expect(deriveGuestStay(GUEST, [])).toMatchObject({
      entryDate: null,
      exitDate: null,
      inHotel: false,
    });
  });

  it('no cuenta los movimientos de otro huésped', () => {
    const otherGuest = randomUUID();

    expect(
      deriveGuestStay(GUEST, [
        ENTRY,
        movement('DEPARTURE', '2026-10-10', otherGuest),
      ]),
    ).toMatchObject({ exitDate: null, inHotel: true });
  });

  it('un colombiano no es extranjero', () => {
    const colombian = GuestData.restore({
      ...GUEST.snapshot(),
      nationality: 'Colombia',
      originPlace: null,
      destinationPlace: null,
    });

    expect(deriveGuestStay(colombian, [ENTRY]).guest.isForeign).toBe(false);
  });
});
