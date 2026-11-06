import { describe, expect, it } from 'vitest';
import {
  checkGuestCounts,
  checkNotes,
  checkRoomList,
  checkStayDates,
} from '../../../../src/domain/reservation/reservation-rules.js';

/** El día operativo del escenario de FR-004a: hoy es el 28. */
const TODAY = '2026-10-28';

const fails = (check: () => void, errorCode: string, message: string) =>
  expect(check).toThrow(expect.objectContaining({ errorCode, message }));

describe('Reglas de la reserva al modificar (plan de update-reservation, punto 12)', () => {
  describe('checkStayDates (paso 3)', () => {
    it('del 28 al 30, con hoy el 28: válidas (el mismo día operativo se acepta)', () => {
      expect(() =>
        checkStayDates('2026-10-28', '2026-10-30', TODAY),
      ).not.toThrow();
    });

    it('la entrada el 27, con hoy el 28: START_DATE_IN_PAST', () => {
      fails(
        () => checkStayDates('2026-10-27', '2026-10-30', TODAY),
        'START_DATE_IN_PAST',
        'La fecha de entrada no puede ser anterior a hoy.',
      );
    });

    it('al día siguiente el mínimo avanza: la entrada el 28 ya no vale con hoy el 29', () => {
      fails(
        () => checkStayDates('2026-10-28', '2026-10-30', '2026-10-29'),
        'START_DATE_IN_PAST',
        'La fecha de entrada no puede ser anterior a hoy.',
      );
    });

    it.each([
      ['la salida el mismo día de la entrada', '2026-10-29', '2026-10-29'],
      ['la salida antes de la entrada', '2026-10-30', '2026-10-29'],
      ['una entrada vacía', '', '2026-10-30'],
      // El 31 de noviembre no existe, y como texto va después de la entrada: solo lo detecta revisar la salida.
      ['una salida que no existe', '2026-10-29', '2026-11-31'],
      ['una fecha con otra forma', '29/10/2026', '2026-10-30'],
    ])('%s: INVALID_RESERVATION_DATES', (_caso, startDate, endDate) => {
      fails(
        () => checkStayDates(startDate, endDate, TODAY),
        'INVALID_RESERVATION_DATES',
        'La fecha de salida debe ser posterior a la de entrada.',
      );
    });

    it('una fecha que no existe va antes que la entrada en el pasado', () => {
      fails(
        () => checkStayDates('2026-02-30', '2026-10-30', TODAY),
        'INVALID_RESERVATION_DATES',
        'La fecha de salida debe ser posterior a la de entrada.',
      );
    });

    it('la entrada en el pasado va antes que la salida no posterior', () => {
      fails(
        () => checkStayDates('2026-10-27', '2026-10-27', TODAY),
        'START_DATE_IN_PAST',
        'La fecha de entrada no puede ser anterior a hoy.',
      );
    });
  });

  describe('checkRoomList (paso 4, sin el inventario)', () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => `uuid-${i + 1}`);

    it.each([1, 10])('con %s habitaciones distintas: válida', (count) => {
      expect(() => checkRoomList(ids(count))).not.toThrow();
    });

    it('vacía: LAST_ROOM_CANNOT_BE_REMOVED', () => {
      fails(
        () => checkRoomList([]),
        'LAST_ROOM_CANNOT_BE_REMOVED',
        'La reserva debe conservar al menos una habitación.',
      );
    });

    it('con 11: INVALID_ROOM_COUNT', () => {
      fails(
        () => checkRoomList(ids(11)),
        'INVALID_ROOM_COUNT',
        'Una reserva debe tener entre 1 y 10 habitaciones.',
      );
    });

    it('con una repetida: ROOM_ALREADY_IN_RESERVATION', () => {
      fails(
        () => checkRoomList(['uuid-201', 'uuid-305', 'uuid-201']),
        'ROOM_ALREADY_IN_RESERVATION',
        'La habitación ya forma parte de la reserva.',
      );
    });

    it('con 11 y una repetida, primero la cantidad', () => {
      fails(
        () => checkRoomList([...ids(10), 'uuid-1']),
        'INVALID_ROOM_COUNT',
        'Una reserva debe tener entre 1 y 10 habitaciones.',
      );
    });
  });

  describe('checkGuestCounts (paso 5)', () => {
    it('de 1 hasta la capacidad: válidas', () => {
      expect(() =>
        checkGuestCounts([
          { guestCount: 1, maxCapacity: 2 },
          { guestCount: 2, maxCapacity: 2 },
        ]),
      ).not.toThrow();
    });

    it('3 en una habitación de 2 (escenario de capacidad): GUEST_COUNT_EXCEEDS_CAPACITY', () => {
      fails(
        () => checkGuestCounts([{ guestCount: 3, maxCapacity: 2 }]),
        'GUEST_COUNT_EXCEEDS_CAPACITY',
        'La cantidad de personas supera la capacidad de la habitación.',
      );
    });

    it('0 personas: GUEST_COUNT_TOO_LOW', () => {
      fails(
        () => checkGuestCounts([{ guestCount: 0, maxCapacity: 2 }]),
        'GUEST_COUNT_TOO_LOW',
        'Cada habitación debe tener al menos una persona.',
      );
    });

    it('se revisan en orden: la primera que falla responde', () => {
      fails(
        () =>
          checkGuestCounts([
            { guestCount: 3, maxCapacity: 2 },
            { guestCount: 0, maxCapacity: 2 },
          ]),
        'GUEST_COUNT_EXCEEDS_CAPACITY',
        'La cantidad de personas supera la capacidad de la habitación.',
      );
    });
  });

  describe('checkNotes (paso 6)', () => {
    it.each([null, '', 'a'.repeat(500)])('%j: válida', (notes) => {
      expect(() => checkNotes(notes)).not.toThrow();
    });

    it('501 caracteres: NOTES_TOO_LONG', () => {
      fails(
        () => checkNotes('a'.repeat(501)),
        'NOTES_TOO_LONG',
        'Las observaciones no pueden superar 500 caracteres.',
      );
    });
  });
});
