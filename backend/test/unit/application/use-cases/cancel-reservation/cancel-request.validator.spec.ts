import { describe, expect, it } from 'vitest';
import {
  checkAcknowledged,
  checkCancelRequest,
} from '../../../../../src/application/use-cases/cancel-reservation/cancel-request.validator.js';

/** La referencia y el motivo del ejemplo de A del plan. */
const REF = 'RSV-3F9A1C7B';
const REASON = 'El huésped cambió de planes';

const fails = (check: () => void, errorCode: string, message: string) =>
  expect(check).toThrow(expect.objectContaining({ errorCode, message }));

describe('Validador de la cancelación (plan de cancel-reservation, punto 9)', () => {
  describe('checkCancelRequest (paso 1)', () => {
    it('el ejemplo de A es válido', () => {
      expect(() => checkCancelRequest(REF, REASON)).not.toThrow();
    });

    it.each([null, undefined])('sin motivo (%s) es válido', (reason) => {
      expect(() => checkCancelRequest(REF, reason)).not.toThrow();
    });

    it('un motivo de 500 caracteres, con saltos de línea y tabulaciones, es válido', () => {
      const reason = `Primera línea\n\tsegunda línea${'a'.repeat(472)}`;
      expect(reason).toHaveLength(500);

      expect(() => checkCancelRequest(REF, reason)).not.toThrow();
    });

    it.each<[string, string | null | undefined]>([
      ['nula', null],
      ['ausente', undefined],
      ['vacía', ''],
      ['solo con espacios', '   '],
    ])(
      'la referencia %s: RESERVATION_REF_REQUIRED',
      (_caso, reservationRef) => {
        fails(
          () => checkCancelRequest(reservationRef, REASON),
          'RESERVATION_REF_REQUIRED',
          'La referencia de la reserva es obligatoria.',
        );
      },
    );

    it.each([
      ['en minúscula', 'rsv-3f9a1c7b'],
      ['con 7 hexadecimales', 'RSV-3F9A1C7'],
      ['con una letra que no es hexadecimal', 'RSV-3F9A1C7G'],
      ['sin el prefijo', '3F9A1C7B'],
      ['con espacios alrededor', ' RSV-3F9A1C7B '],
      ['con caracteres de inyección', "RSV-3F9A1C7B' OR 1=1"],
    ])(
      'la referencia %s: INVALID_RESERVATION_CODE',
      (_caso, reservationRef) => {
        fails(
          () => checkCancelRequest(reservationRef, REASON),
          'INVALID_RESERVATION_CODE',
          'Debe proveer un código de reserva válido para la consulta.',
        );
      },
    );

    it('un motivo de 501 caracteres: REASON_TOO_LONG', () => {
      fails(
        () => checkCancelRequest(REF, 'a'.repeat(501)),
        'REASON_TOO_LONG',
        'El motivo no puede superar 500 caracteres.',
      );
    });

    it.each([
      ['el carácter nulo', 'motivo\u0000'],
      ['un retorno de carro', 'motivo\rfalso'],
      ['un carácter de escape', 'motivo\u001b[31m'],
      ['un control C1', 'motivo\u0085'],
    ])('un motivo con %s: INVALID_CHARACTERS', (_caso, reason) => {
      fails(
        () => checkCancelRequest(REF, reason),
        'INVALID_CHARACTERS',
        'El formato de los datos contiene caracteres no válidos.',
      );
    });

    it('la referencia se revisa antes que el motivo', () => {
      fails(
        () => checkCancelRequest('RSV-123', 'a'.repeat(501)),
        'INVALID_RESERVATION_CODE',
        'Debe proveer un código de reserva válido para la consulta.',
      );
    });

    it('el largo del motivo se revisa antes que sus caracteres', () => {
      fails(
        () => checkCancelRequest(REF, `\u0000${'a'.repeat(500)}`),
        'REASON_TOO_LONG',
        'El motivo no puede superar 500 caracteres.',
      );
    });
  });

  describe('checkAcknowledged (paso 3, solo en A)', () => {
    it('con true pasa', () => {
      expect(() => checkAcknowledged(true)).not.toThrow();
    });

    it.each<[string, unknown]>([
      ['false', false],
      ['ausente', undefined],
      ['nulo', null],
      ['el texto "true"', 'true'],
      ['el número 1', 1],
    ])('%s: CANCELLATION_NOT_CONFIRMED', (_caso, acknowledged) => {
      fails(
        () => checkAcknowledged(acknowledged),
        'CANCELLATION_NOT_CONFIRMED',
        'Debe confirmar que entiende que la cancelación no se puede deshacer.',
      );
    });
  });
});
