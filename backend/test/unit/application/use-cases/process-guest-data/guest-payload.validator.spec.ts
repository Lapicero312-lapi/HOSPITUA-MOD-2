import { describe, expect, it } from 'vitest';
import {
  readGuestNotification,
  UnusableGuestPayloadError,
} from '../../../../../src/application/use-cases/process-guest-data/guest-payload.validator.js';

const INVALID_PAYLOAD = 'Payload inválido.';
const INVALID_CHARACTERS =
  'Caracteres no válidos en los datos de los huéspedes.';

const ANA = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};

const JOHN = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};

/** El mensaje de Check-In del contrato A (plan de `update-reservation`), con un `roomId` real. */
function aCheckIn(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    messageId: '7c1e9a52-3b0d-4f7e-9a61-2d8c5b4e1f03',
    sequenceNumber: 123,
    reservationRef: 'RSV-8D02E5A4',
    roomId: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
    movementType: 'ENTRY',
    movementDate: '2026-10-09',
    guests: [ANA, JOHN],
    ...changes,
  };
}

/** Un Check-In con un solo huésped, Ana, con los datos cambiados. */
function withGuest(changes: Record<string, unknown>): Record<string, unknown> {
  return aCheckIn({ guests: [{ ...ANA, ...changes }] });
}

function errorOf(payload: unknown, expected: 'ENTRY' | 'DEPARTURE' = 'ENTRY') {
  try {
    readGuestNotification(payload, expected);
  } catch (error) {
    if (error instanceof UnusableGuestPayloadError) {
      return error.message;
    }
    throw error;
  }
  throw new Error('No lanzó ningún error');
}

describe('readGuestNotification (plan, "Validación de estructura")', () => {
  describe('notificación utilizable', () => {
    it('el Check-In del contrato A: devuelve sus datos tal como llegaron', () => {
      expect(readGuestNotification(aCheckIn(), 'ENTRY')).toEqual({
        reservationRef: 'RSV-8D02E5A4',
        roomId: '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
        movementType: 'ENTRY',
        movementDate: '2026-10-09',
        guests: [ANA, JOHN],
      });
    });

    it('el Check-Out con DEPARTURE en la cola de Check-Out', () => {
      const checkOut = aCheckIn({
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
      });

      expect(readGuestNotification(checkOut, 'DEPARTURE')).toMatchObject({
        movementType: 'DEPARTURE',
        movementDate: '2026-10-12',
      });
    });

    it('acepta el roomId en mayúsculas', () => {
      const roomId = '3F2B8C1E-5A4D-4E6F-9B7A-1C2D3E4F5A6B';

      expect(readGuestNotification(aCheckIn({ roomId }), 'ENTRY').roomId).toBe(
        roomId,
      );
    });

    it.each([
      ['un apóstrofe', { lastName: "O'Brien" }],
      ['un guion sencillo', { firstName: 'Ana-María' }],
      ['tildes, ñ y espacios', { lastName: 'Núñez de la Peña' }],
      ['el lugar de procedencia vacío de un colombiano', { originPlace: '' }],
      ['espacios en los extremos', { firstName: ' Ana ' }],
    ])('acepta %s y no cambia el dato', (_caso, changes) => {
      const [guest] = readGuestNotification(withGuest(changes), 'ENTRY').guests;

      expect(guest).toEqual({ ...ANA, ...changes });
    });

    it('no exige los datos del huésped: uno que falta o llega como null no está (lo omite register, regla 3)', () => {
      const payload = aCheckIn({
        guests: [{ firstName: 'Ana', documentNumber: null }, {}],
      });

      expect(readGuestNotification(payload, 'ENTRY').guests).toEqual([
        { firstName: 'Ana' },
        {},
      ]);
    });

    it('deja fuera los campos que no son del contrato A', () => {
      const payload = aCheckIn({ guests: [{ ...ANA, extra: 'x' }] });

      const notification = readGuestNotification(payload, 'ENTRY');

      expect(notification).not.toHaveProperty('messageId');
      expect(notification.guests[0]).toEqual(ANA);
    });
  });

  describe('"Payload inválido."', () => {
    it.each<[string, unknown]>([
      ['vacío', undefined],
      ['null', null],
      ['un texto', 'RSV-8D02E5A4'],
      ['una lista', [aCheckIn()]],
      ['un número', 42],
    ])('una notificación que no es un objeto: %s', (_caso, payload) => {
      expect(errorOf(payload)).toBe(INVALID_PAYLOAD);
    });

    it.each<[string, Record<string, unknown>]>([
      ['sin reservationRef', { reservationRef: undefined }],
      ['reservationRef en minúscula', { reservationRef: 'rsv-8d02e5a4' }],
      ['reservationRef con 7 hexadecimales', { reservationRef: 'RSV-8D02E5A' }],
      [
        'reservationRef con una letra que no es hexadecimal',
        { reservationRef: 'RSV-8D02E5AG' },
      ],
      ['reservationRef como número', { reservationRef: 8020 }],
      ['sin roomId', { roomId: undefined }],
      ['roomId que no es UUID', { roomId: '101' }],
      ['sin movementType', { movementType: undefined }],
      [
        'movementType DEPARTURE en la cola de Check-In',
        { movementType: 'DEPARTURE' },
      ],
      ['movementType desconocido', { movementType: 'CHECKIN' }],
      ['sin movementDate', { movementDate: undefined }],
      [
        'movementDate con un día que el mes no tiene',
        { movementDate: '2026-02-30' },
      ],
      ['movementDate con el mes 13', { movementDate: '2026-13-01' }],
      ['movementDate en otro formato', { movementDate: '09/10/2026' }],
      ['sin guests', { guests: undefined }],
      ['guests vacío', { guests: [] }],
      ['guests que no es una lista', { guests: ANA }],
      ['un huésped que no es un objeto', { guests: [ANA, 'John'] }],
      ['un huésped null', { guests: [null] }],
      ['un huésped que es una lista', { guests: [[ANA]] }],
      [
        'un dato del huésped como número',
        { guests: [{ ...ANA, documentNumber: 123 }] },
      ],
      [
        'un dato del huésped como objeto',
        { guests: [{ ...ANA, nationality: { name: 'Colombia' } }] },
      ],
      [
        'un dato del huésped como booleano',
        { guests: [{ ...ANA, firstName: true }] },
      ],
    ])('%s', (_caso, changes) => {
      expect(errorOf(aCheckIn(changes))).toBe(INVALID_PAYLOAD);
    });

    it('ENTRY en la cola de Check-Out', () => {
      expect(errorOf(aCheckIn(), 'DEPARTURE')).toBe(INVALID_PAYLOAD);
    });

    it('la estructura se revisa antes que los caracteres', () => {
      expect(
        errorOf(
          aCheckIn({
            roomId: undefined,
            guests: [{ ...ANA, firstName: '<b>' }],
          }),
        ),
      ).toBe(INVALID_PAYLOAD);
    });
  });

  describe('"Caracteres no válidos en los datos de los huéspedes."', () => {
    it.each([
      ['<', { firstName: '<script>' }],
      ['>', { lastName: 'Pérez>' }],
      ['{', { documentNumber: '{123' }],
      ['}', { nationality: 'Colombia}' }],
      ['\\', { originPlace: 'Cali\\Valle' }],
      [';', { documentNumber: '123; DROP TABLE guest_data' }],
      ['--', { lastName: "Pérez' --" }],
      ['un carácter nulo', { firstName: 'Ana\u0000' }],
      ['un salto de línea', { destinationPlace: 'Cali\nValle' }],
      ['un tabulador', { lastName: 'Pé\trez' }],
      ['DEL', { birthDate: '1995-03-20\u007f' }],
      ['un control C1', { documentType: 'CC\u0085' }],
    ])('%s en un dato del huésped', (_caso, changes) => {
      expect(errorOf(withGuest(changes))).toBe(INVALID_CHARACTERS);
    });

    it('en el segundo huésped de la lista', () => {
      expect(
        errorOf(aCheckIn({ guests: [ANA, { ...JOHN, firstName: 'Jo>hn' }] })),
      ).toBe(INVALID_CHARACTERS);
    });

    it('en un campo del huésped que no es del contrato A', () => {
      expect(errorOf(withGuest({ notes: '<img src=x>' }))).toBe(
        INVALID_CHARACTERS,
      );
    });

    it('en un campo del mensaje que no es del contrato A', () => {
      expect(errorOf(aCheckIn({ source: 'm1;rm' }))).toBe(INVALID_CHARACTERS);
    });
  });
});
