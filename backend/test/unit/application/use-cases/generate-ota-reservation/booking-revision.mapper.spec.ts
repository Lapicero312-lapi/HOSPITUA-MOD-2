import { describe, expect, it } from 'vitest';
import type {
  BookingRevision,
  BookingRevisionCustomer,
  BookingRevisionRoom,
} from '../../../../../src/application/integration/booking-revision.js';
import {
  isIllegible,
  mapBookingRevision,
  type IllegibleRevision,
  type OtaReservationData,
} from '../../../../../src/application/use-cases/generate-ota-reservation/booking-revision.mapper.js';
import { Money } from '../../../../../src/domain/shared/money.js';

/** La habitación del ejemplo de A1 del plan. */
function aRoom(
  changes: Partial<BookingRevisionRoom> = {},
): BookingRevisionRoom {
  return {
    roomTypeId: '994d1375-dbbd-4072-8724-b2ab32ce781b',
    ratePlanId: '445835fb-7956-42ac-9efc-3e6f331f0808',
    checkinDate: '2026-11-10',
    checkoutDate: '2026-11-12',
    adults: 2,
    children: 0,
    infants: 0,
    ...changes,
  };
}

/** La revisión del ejemplo de A1 del plan, ya leída por el adaptador. */
function aRevision(
  changes: Partial<BookingRevision> = {},
  customer: Partial<BookingRevisionCustomer> = {},
): BookingRevision {
  return {
    id: '03dd7198-c5b7-493c-a889-74d0c2211de7',
    bookingId: 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd',
    otaReservationCode: '9996013801',
    otaName: 'Booking.com',
    status: 'new',
    arrivalDate: '2026-11-10',
    departureDate: '2026-11-12',
    amount: Money.of('220.00', 'USD'),
    otaCommission: Money.of('33.00', 'USD'),
    notes: 'Llegada tarde',
    customer: {
      name: 'Ana',
      surname: 'Pérez',
      mail: 'ana@correo.com',
      phone: '+57 300 000 0000',
      country: 'CO',
      ...customer,
    },
    rooms: [aRoom()],
    ...changes,
  };
}

function mapped(revision: BookingRevision): OtaReservationData {
  const result = mapBookingRevision(revision);
  if (isIllegible(result)) {
    throw new Error(`Se esperaba una revisión legible: ${result.reason}`);
  }
  return result;
}

function reasonOf(revision: BookingRevision): string {
  const result = mapBookingRevision(revision);
  expect(isIllegible(result)).toBe(true);
  return (result as IllegibleRevision).reason;
}

const text = (size: number) => 'a'.repeat(size);

describe('mapBookingRevision', () => {
  describe('la tabla de B del plan', () => {
    it('convierte la revisión del ejemplo de A1 en los datos del Módulo 2', () => {
      const data = mapped(aRevision());

      expect(data).toEqual({
        externalConfirmationCode: '9996013801',
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        grossAmount: Money.of('220.00', 'USD'),
        otaCommission: Money.of('33.00', 'USD'),
        notes: 'Llegada tarde',
        guest: {
          firstName: 'Ana',
          lastName: 'Pérez',
          documentType: null,
          documentNumber: null,
          nationality: 'Colombia',
          contactPhone: '+57 300 000 0000',
          contactEmail: 'ana@correo.com',
        },
        rooms: [
          {
            channexRoomTypeId: '994d1375-dbbd-4072-8724-b2ab32ce781b',
            checkinDate: '2026-11-10',
            checkoutDate: '2026-11-12',
            guestCount: 2,
          },
        ],
      });
      expect(data.grossAmount?.amount).toBe('220');
      expect(data.grossAmount?.currency).toBe('USD');
    });

    it('copia el titular tal como llega, sin quitarle espacios ni cambiarlo', () => {
      const data = mapped(
        aRevision({}, { name: ' Ana María ', surname: 'Pérez  Gómez' }),
      );

      expect(data.guest.firstName).toBe(' Ana María ');
      expect(data.guest.lastName).toBe('Pérez  Gómez');
    });

    it('convierte el código de país con CountryNames', () => {
      expect(mapped(aRevision({}, { country: 'US' })).guest.nationality).toBe(
        'Estados Unidos',
      );
    });

    it.each([
      ['no está en la tabla', 'XK'],
      ['no viene', null],
    ])(
      'si el código de país %s, la nacionalidad queda vacía',
      (_caso, country) => {
        expect(mapped(aRevision({}, { country })).guest.nationality).toBeNull();
      },
    );

    it('sin correo ni teléfono, el contacto queda vacío', () => {
      const { guest } = mapped(aRevision({}, { mail: null, phone: null }));

      expect(guest.contactEmail).toBeNull();
      expect(guest.contactPhone).toBeNull();
    });

    it('sin comisión la deja vacía: la decide el caso de uso (paso 7 de B1)', () => {
      const data = mapped(aRevision({ otaCommission: null }));

      expect(data.otaCommission).toBeNull();
      expect(data.grossAmount).toEqual(Money.of('220.00', 'USD'));
    });

    it('cada habitación cuenta adultos y niños, sin los bebés', () => {
      const data = mapped(
        aRevision({
          rooms: [
            aRoom({ adults: 2, children: 1, infants: 1 }),
            aRoom({ adults: 1, children: 0, infants: 2 }),
          ],
        }),
      );

      expect(data.rooms.map((room) => room.guestCount)).toEqual([3, 1]);
    });

    it('una habitación solo con niños cuenta los niños', () => {
      const data = mapped(
        aRevision({ rooms: [aRoom({ adults: 0, children: 2 })] }),
      );

      expect(data.rooms[0]?.guestCount).toBe(2);
    });

    it('pasa el tipo de habitación vacío y las fechas de cada habitación: los decide el caso de uso (pasos 3 y 4 de B1)', () => {
      const data = mapped(
        aRevision({
          rooms: [
            aRoom({
              roomTypeId: null,
              checkinDate: '2026-11-11',
              checkoutDate: '2026-11-12',
            }),
          ],
        }),
      );

      expect(data.rooms[0]).toEqual({
        channexRoomTypeId: null,
        checkinDate: '2026-11-11',
        checkoutDate: '2026-11-12',
        guestCount: 2,
      });
    });

    it('no cambia la revisión que recibe', () => {
      const notes = '  Llegada\u0000 tarde  ';
      const revision = aRevision({ notes, rooms: [aRoom({ children: 1 })] });

      mapBookingRevision(revision);

      expect(revision).toEqual(
        aRevision({ notes, rooms: [aRoom({ children: 1 })] }),
      );
    });
  });

  describe('notes (punto 5 del plan)', () => {
    const notesOf = (notes: string | null) =>
      mapped(aRevision({ notes })).notes;

    it('quita los caracteres de control', () => {
      expect(notesOf('Llegada\u0000 tarde\u0007\u001B\u007F')).toBe(
        'Llegada tarde',
      );
    });

    it('quita también los caracteres de control C1 (\\p{Cc} incluye U+0080 a U+009F)', () => {
      expect(notesOf('Llegada\u0085 tarde\u009B\u0080\u009F')).toBe(
        'Llegada tarde',
      );
    });

    it('conserva el salto de línea y la tabulación, y quita el retorno de carro', () => {
      expect(notesOf('Primera línea\r\nSegunda\tlínea')).toBe(
        'Primera línea\nSegunda\tlínea',
      );
    });

    it('quita los espacios alrededor', () => {
      expect(notesOf('  \n Llegada tarde \t ')).toBe('Llegada tarde');
    });

    it('conserva las tildes, la ñ y los emojis', () => {
      expect(notesOf('Cumpleaños de Ana 🎂')).toBe('Cumpleaños de Ana 🎂');
    });

    it('deja exactamente 500 caracteres si son 500', () => {
      expect(notesOf(text(500))).toBe(text(500));
    });

    it('recorta a 500 caracteres', () => {
      expect(notesOf(text(501))).toBe(text(500));
    });

    it('cuenta caracteres, no unidades de JavaScript: no parte un emoji', () => {
      const notes = notesOf('🎂'.repeat(600));

      expect(Array.from(notes ?? '')).toHaveLength(500);
      expect(notes).toBe('🎂'.repeat(500));
    });

    it('recorta después de limpiar: los caracteres de control no cuentan', () => {
      expect(notesOf(`\u0000${text(500)}\u0000`)).toBe(text(500));
    });

    it('recorta después de quitar los espacios alrededor: no cuentan para los 500', () => {
      expect(notesOf(`  ${text(500)}`)).toBe(text(500));
    });

    it.each([
      ['no viene', null],
      ['está vacía', ''],
      ['solo trae espacios', '   '],
      ['solo trae caracteres de control', '\u0000\u0007'],
    ])('si %s, queda vacía', (_caso, notes) => {
      expect(notesOf(notes)).toBeNull();
    });
  });

  describe('revisión ilegible (punto 5 del plan)', () => {
    it.each<[string, BookingRevision, string]>([
      [
        'sin ota_reservation_code',
        aRevision({ otaReservationCode: null }),
        'sin ota_reservation_code',
      ],
      [
        'con ota_reservation_code de solo espacios',
        aRevision({ otaReservationCode: '   ' }),
        'sin ota_reservation_code',
      ],
      [
        'con ota_reservation_code de 51 caracteres',
        aRevision({ otaReservationCode: text(51) }),
        'ota_reservation_code de más de 50 caracteres',
      ],
      [
        'sin nombre del titular',
        aRevision({}, { name: null }),
        'el titular sin nombre o sin apellido',
      ],
      [
        'con el apellido del titular de solo espacios',
        aRevision({}, { surname: '  ' }),
        'el titular sin nombre o sin apellido',
      ],
      [
        'con el nombre del titular de 101 caracteres',
        aRevision({}, { name: text(101) }),
        'el nombre o el apellido del titular de más de 100 caracteres',
      ],
      [
        'con el apellido del titular de 101 caracteres',
        aRevision({}, { surname: text(101) }),
        'el nombre o el apellido del titular de más de 100 caracteres',
      ],
      [
        'con el teléfono de 31 caracteres',
        aRevision({}, { phone: text(31) }),
        'el teléfono del titular de más de 30 caracteres',
      ],
      [
        'con el correo de 255 caracteres',
        aRevision({}, { mail: text(255) }),
        'el correo del titular de más de 254 caracteres',
      ],
      ['sin habitaciones', aRevision({ rooms: [] }), 'sin habitaciones'],
      [
        'con 11 habitaciones',
        aRevision({ rooms: Array.from({ length: 11 }, () => aRoom()) }),
        'más de 10 habitaciones',
      ],
      [
        'con una habitación sin adultos ni niños',
        aRevision({
          rooms: [aRoom(), aRoom({ adults: 0, children: 0, infants: 1 })],
        }),
        'una habitación sin personas',
      ],
      [
        'sin el valor (amount)',
        aRevision({ amount: null }),
        'sin el valor (amount) con su moneda',
      ],
      [
        'con los adultos de una habitación con otra forma',
        aRevision({ rooms: [aRoom(), aRoom({ adults: null, children: 1 })] }),
        'una habitación con los adultos o los niños con otra forma',
      ],
      [
        'con los niños de una habitación con otra forma',
        aRevision({ rooms: [aRoom({ adults: 2, children: null })] }),
        'una habitación con los adultos o los niños con otra forma',
      ],
      [
        'con más personas en una habitación de las que caben en guest_count',
        aRevision({ rooms: [aRoom({ adults: 32_767, children: 1 })] }),
        'una habitación con más de 32767 personas',
      ],
    ])('%s', (_caso, revision, reason) => {
      expect(reasonOf(revision)).toBe(reason);
    });

    it.each<[string, BookingRevision]>([
      [
        'ota_reservation_code de 50 caracteres',
        aRevision({ otaReservationCode: text(50) }),
      ],
      [
        'nombre y apellido de 100 caracteres',
        aRevision({}, { name: text(100), surname: text(100) }),
      ],
      ['teléfono de 30 caracteres', aRevision({}, { phone: text(30) })],
      ['correo de 254 caracteres', aRevision({}, { mail: text(254) })],
      [
        '32767 personas en una habitación',
        aRevision({ rooms: [aRoom({ adults: 32_766, children: 1 })] }),
      ],
      [
        '10 habitaciones',
        aRevision({ rooms: Array.from({ length: 10 }, () => aRoom()) }),
      ],
    ])('con %s, la revisión sí se puede guardar', (_caso, revision) => {
      expect(isIllegible(mapBookingRevision(revision))).toBe(false);
    });

    it('cuenta caracteres, no unidades de JavaScript: un nombre de 100 emojis cabe', () => {
      expect(
        isIllegible(
          mapBookingRevision(aRevision({}, { name: '😀'.repeat(100) })),
        ),
      ).toBe(false);
    });

    it('el motivo no lleva datos personales', () => {
      const name = 'Valentina'.repeat(12);
      const reason = reasonOf(aRevision({}, { name }));

      expect(reason).not.toContain('Valentina');
    });
  });
});
