import { describe, expect, it } from 'vitest';
import {
  INVALID_PAYLOAD,
  MISSING_IDENTIFIERS,
  readRoomNotification,
} from '../../../../../src/infrastructure/in/messaging/room-notification.reader.js';
import { InvalidMessageError } from '../../../../../src/infrastructure/in/messaging/retry-or-dead-letter.js';

const INVALID_CHARACTERS =
  'Caracteres no válidos en los datos de los huéspedes.';

/** El mensaje de Check-In del contrato A del plan de `update-reservation`. */
function aCheckIn(
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    messageId: '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f',
    sequenceNumber: 123,
    reservationRef: 'RSV-8D02E5A4',
    roomId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    movementType: 'ENTRY',
    movementDate: '2026-10-09',
    guests: [
      {
        firstName: 'Ana',
        lastName: 'Pérez',
        documentType: 'CC',
        documentNumber: '123',
        birthDate: '1995-03-20',
        nationality: 'Colombia',
      },
      {
        firstName: 'John',
        lastName: 'Smith',
        documentType: 'PAS',
        documentNumber: 'X99',
        birthDate: '1990-05-12',
        nationality: 'Estados Unidos',
        originPlace: 'Miami, Estados Unidos',
        destinationPlace: 'Cartagena, Colombia',
      },
    ],
    ...changes,
  };
}

/** Un mensaje sin ese campo. */
function without(field: string): Record<string, unknown> {
  const message = aCheckIn();
  delete message[field];
  return message;
}

/** El mensaje con el que `readRoomNotification` manda a la dead-letter. */
function rejectionOf(message: unknown): string {
  try {
    readRoomNotification(message, 'ENTRY');
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidMessageError);
    return (error as InvalidMessageError).message;
  }
  throw new Error('El mensaje no se rechazó');
}

describe('readRoomNotification (D3 de update-reservation; T008 de process-guest-data)', () => {
  it('devuelve el mensaje del contrato A tal como llegó, con su messageId y su sequenceNumber', () => {
    const message = aCheckIn();

    expect(readRoomNotification(message, 'ENTRY')).toEqual({
      messageId: '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f',
      sequenceNumber: 123,
      reservationRef: 'RSV-8D02E5A4',
      roomId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      movementType: 'ENTRY',
      movementDate: '2026-10-09',
      guests: message.guests,
    });
  });

  it('acepta el sequenceNumber 0 y un huésped incompleto: omitirlo es cosa de process-guest-data (regla 3)', () => {
    const notification = readRoomNotification(
      aCheckIn({ sequenceNumber: 0, guests: [{ documentNumber: 'X99' }] }),
      'ENTRY',
    );

    expect(notification.sequenceNumber).toBe(0);
    expect(notification.guests).toEqual([{ documentNumber: 'X99' }]);
  });

  describe('vacía, sin la reservationRef o sin el roomId: el mensaje del spec de update-reservation', () => {
    it.each([
      ['nada', null],
      ['un texto', 'hola'],
      ['una lista', []],
      ['un objeto vacío', {}],
      ['sin reservationRef', without('reservationRef')],
      ['con la reservationRef vacía', aCheckIn({ reservationRef: '' })],
      ['con la reservationRef numérica', aCheckIn({ reservationRef: 123 })],
      ['sin roomId', without('roomId')],
      ['con el roomId vacío', aCheckIn({ roomId: '' })],
      ['con el roomId nulo', aCheckIn({ roomId: null })],
    ])('%s', (_case, message) => {
      expect(rejectionOf(message)).toBe(MISSING_IDENTIFIERS);
    });

    it('el mensaje es el literal del spec', () => {
      expect(MISSING_IDENTIFIERS).toBe(
        'El payload de notificación es inválido. Falta el identificador de la reserva o de la habitación.',
      );
    });
  });

  describe('la estructura de process-guest-data: "Payload inválido."', () => {
    it.each([
      [
        'la reservationRef con otro formato',
        aCheckIn({ reservationRef: 'RSV-123' }),
      ],
      ['el roomId que no es UUID', aCheckIn({ roomId: '201' })],
      [
        'un DEPARTURE en la cola de Check-In',
        aCheckIn({ movementType: 'DEPARTURE' }),
      ],
      ['una fecha que no existe', aCheckIn({ movementDate: '2026-02-30' })],
      ['sin guests', without('guests')],
      ['guests vacía', aCheckIn({ guests: [] })],
      [
        'un huésped con un dato numérico',
        aCheckIn({ guests: [{ documentNumber: 99 }] }),
      ],
    ])('%s', (_case, message) => {
      expect(rejectionOf(message)).toBe(INVALID_PAYLOAD);
    });

    it('el mensaje es el literal del plan de process-guest-data', () => {
      expect(INVALID_PAYLOAD).toBe('Payload inválido.');
    });
  });

  it.each([
    [
      'un nombre con <script>',
      aCheckIn({ guests: [{ firstName: '<script>' }] }),
    ],
    ['un comentario SQL', aCheckIn({ guests: [{ lastName: "x'; --" }] })],
    [
      'llaves en la nacionalidad',
      aCheckIn({ guests: [{ nationality: '{}' }] }),
    ],
  ])(
    'con %s: "Caracteres no válidos en los datos de los huéspedes."',
    (_case, message) => {
      expect(rejectionOf(message)).toBe(INVALID_CHARACTERS);
    },
  );

  describe('el messageId y el sequenceNumber: "Payload inválido."', () => {
    it.each([
      ['sin messageId', without('messageId')],
      ['con el messageId que no es UUID', aCheckIn({ messageId: 'msg-1' })],
      ['sin sequenceNumber', without('sequenceNumber')],
      ['con el sequenceNumber como texto', aCheckIn({ sequenceNumber: '123' })],
      ['con el sequenceNumber decimal', aCheckIn({ sequenceNumber: 1.5 })],
      ['con el sequenceNumber negativo', aCheckIn({ sequenceNumber: -1 })],
      [
        'con el sequenceNumber demasiado grande',
        aCheckIn({ sequenceNumber: 2 ** 53 }),
      ],
    ])('%s', (_case, message) => {
      expect(rejectionOf(message)).toBe(INVALID_PAYLOAD);
    });
  });

  describe('el orden: el primero que falla decide el mensaje', () => {
    it('sin roomId y con el messageId malo: falta el identificador', () => {
      const message = without('roomId');
      message.messageId = 'msg-1';

      expect(rejectionOf(message)).toBe(MISSING_IDENTIFIERS);
    });

    it('con caracteres no válidos y el messageId malo: los caracteres', () => {
      expect(
        rejectionOf(
          aCheckIn({ messageId: 'msg-1', guests: [{ firstName: '<b>' }] }),
        ),
      ).toBe(INVALID_CHARACTERS);
    });
  });

  it('en la cola de Check-Out espera DEPARTURE', () => {
    expect(
      readRoomNotification(aCheckIn({ movementType: 'DEPARTURE' }), 'DEPARTURE')
        .movementType,
    ).toBe('DEPARTURE');
  });
});
