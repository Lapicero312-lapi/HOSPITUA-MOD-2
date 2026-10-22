import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../../support/builders.js';

describe('Reservation', () => {
  it('su guestCount es la suma de las personas de sus habitaciones', () => {
    const reservation = aDirectReservation({
      rooms: [aDirectRoom({ guestCount: 2 }), aDirectRoom({ guestCount: 3 })],
    });

    expect(reservation.guestCount).toBe(5);
  });

  it('una reserva directa tiene comisión 0', () => {
    expect(aDirectReservation().commissionPercentage).toBe('0');
  });

  it('una reserva OTA guarda el porcentaje congelado de la agencia', () => {
    expect(anOtaReservation(randomUUID()).commissionPercentage).toBe('15');
  });

  it('snapshot y restore dan la misma reserva', () => {
    const reservation = aDirectReservation();

    expect(Reservation.restore(reservation.snapshot())).toEqual(reservation);
  });

  describe('fechas', () => {
    it.each([
      ['la salida es igual a la entrada', '2026-11-10', '2026-11-10'],
      ['la salida es anterior a la entrada', '2026-11-12', '2026-11-10'],
      ['una fecha no es AAAA-MM-DD', '10/11/2026', '2026-11-12'],
    ])('se rechaza si %s', (_, startDate, endDate) => {
      expect(() => aDirectReservation({ startDate, endDate })).toThrow(
        expect.objectContaining({
          errorCode: 'INVALID_RESERVATION_DATES',
          message: 'La fecha de salida debe ser posterior a la de entrada.',
        }),
      );
    });
  });

  describe('habitaciones', () => {
    it.each([
      ['ninguna', 0],
      ['más de 10', 11],
    ])('se rechaza con %s', (_, count) => {
      const rooms = Array.from({ length: count }, () => aDirectRoom());

      expect(() => aDirectReservation({ rooms })).toThrow(
        expect.objectContaining({
          errorCode: 'INVALID_ROOM_COUNT',
          message: 'Una reserva debe tener entre 1 y 10 habitaciones.',
        }),
      );
    });

    it('acepta 10', () => {
      const rooms = Array.from({ length: 10 }, () => aDirectRoom());

      expect(aDirectReservation({ rooms }).rooms).toHaveLength(10);
    });

    it('se rechaza la misma habitación dos veces', () => {
      const roomId = randomUUID();

      expect(() =>
        aDirectReservation({
          rooms: [aDirectRoom({ roomId }), aDirectRoom({ roomId })],
        }),
      ).toThrow(
        expect.objectContaining({
          errorCode: 'ROOM_ALREADY_IN_RESERVATION',
          message: 'La habitación ya forma parte de la reserva.',
        }),
      );
    });

    it('una reserva de Booking puede tener varias habitaciones sin asignar', () => {
      const unassigned = () => anOtaRoom({ roomId: null, roomNumber: null });

      expect(
        anOtaReservation(randomUUID(), { rooms: [unassigned(), unassigned()] })
          .rooms,
      ).toHaveLength(2);
    });
  });

  it('se rechazan notes de más de 500 caracteres', () => {
    expect(() => aDirectReservation({ notes: 'a'.repeat(501) })).toThrow(
      expect.objectContaining({
        errorCode: 'NOTES_TOO_LONG',
        message: 'Las observaciones no pueden superar 500 caracteres.',
      }),
    );
    expect(aDirectReservation({ notes: 'a'.repeat(500) }).notes).toHaveLength(
      500,
    );
  });

  describe('reglas del programa (no del usuario)', () => {
    it.each(['RSV-3f9a1c7b', 'RSV-3F9A1C7', 'ABC-3F9A1C7B'])(
      'una referencia %s no tiene el formato RSV- + 8 hexadecimales',
      (reservationRef) => {
        expect(() => aDirectReservation({ reservationRef })).toThrow(
          /referencia/,
        );
      },
    );

    it('una reserva directa no tiene agencia ni conflicto', () => {
      expect(() => aDirectReservation({ ota: otaTerms(randomUUID()) })).toThrow(
        /directa/,
      );
      expect(() =>
        aDirectReservation({
          conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
        }),
      ).toThrow(/directa/);
    });

    it('cada habitación directa está asignada y tiene tarifa', () => {
      expect(() =>
        aDirectReservation({ rooms: [aDirectRoom({ rate: null })] }),
      ).toThrow(/tarifa/);
      expect(() =>
        aDirectReservation({
          rooms: [aDirectRoom({ roomId: null, roomNumber: null })],
        }),
      ).toThrow(/tarifa/);
    });

    it('una reserva OTA tiene agencia y no tiene tarifa por habitación', () => {
      const otaId = randomUUID();

      expect(() => anOtaReservation(otaId, { ota: null })).toThrow(/agencia/);
      expect(() => anOtaReservation(otaId, { rooms: [aDirectRoom()] })).toThrow(
        /tarifa/,
      );
    });

    it('el porcentaje de comisión va de 0 a 100', () => {
      const otaId = randomUUID();

      expect(() =>
        anOtaReservation(otaId, {
          ota: otaTerms(otaId, { commissionPercentage: '100.01' }),
        }),
      ).toThrow(/porcentaje/);
    });

    it('el valor y la comisión van en la misma moneda', () => {
      const otaId = randomUUID();

      expect(() =>
        anOtaReservation(otaId, {
          ota: otaTerms(otaId, { commissionAmount: Money.of('60', 'COP') }),
        }),
      ).toThrow(/moneda/);
    });
  });
});
