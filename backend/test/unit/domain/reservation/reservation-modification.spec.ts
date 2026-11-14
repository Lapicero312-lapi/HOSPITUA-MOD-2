import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  ModifiedRoomInput,
  ReservationModification,
} from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
} from '../../../support/builders.js';

/** Una tarifa: el monto en COP y su `quoteId`. */
const rateOf = (amount: string, quoteId: string) => ({
  roomGrossAmount: Money.of(amount, 'COP'),
  quoteId,
});

/** La reserva directa: la 201 con 2 personas, ya con su Check-In pendiente, y titular colombiano. */
const aReservation = () =>
  aDirectReservation({
    startDate: '2031-03-20',
    endDate: '2031-03-22',
    rooms: [
      aDirectRoom({
        roomId: randomUUID(),
        roomNumber: '201',
        guestCount: 2,
        rate: rateOf('500000.00', 'Q-201'),
      }),
    ],
    guest: aGuest({ nationality: 'Colombia' }),
    notes: 'Llegada tarde',
  });

/** Una habitación nueva de la 305 de `SUITE`. */
const newRoom = (changes: Partial<ModifiedRoomInput> = {}) => ({
  keptRoomId: null,
  room: { roomId: randomUUID(), roomNumber: '305', categoryRoom: 'SUITE' },
  guestCount: 1,
  rate: rateOf('600000.00', 'Q-305'),
  ...changes,
});

/** El cambio que deja las mismas fechas y la habitación conservada, con lo que se indique. */
const aChange = (
  reservation: ReturnType<typeof aReservation>,
  changes: Partial<ReservationModification> = {},
): ReservationModification => {
  const [kept] = reservation.rooms;
  return {
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    rooms: [
      {
        keptRoomId: kept.id,
        room: {
          roomId: kept.roomId as string,
          roomNumber: kept.roomNumber as string,
          categoryRoom: kept.categoryRoom,
        },
        guestCount: kept.guestCount,
        rate: kept.rate as NonNullable<typeof kept.rate>,
      },
    ],
    guest: undefined,
    notes: undefined,
    ...changes,
  };
};

describe('Reservation.withModification (plan de update-reservation, regla 9; T010 y T011)', () => {
  it('cambia las fechas y no modifica la reserva original', () => {
    const reservation = aReservation();

    const changed = reservation.withModification(
      aChange(reservation, { startDate: '2031-03-21', endDate: '2031-03-24' }),
    );

    expect([changed.startDate, changed.endDate]).toEqual([
      '2031-03-21',
      '2031-03-24',
    ]);
    expect(reservation.startDate).toBe('2031-03-20');
    expect(changed.id).toBe(reservation.id);
    expect(changed.updatedAt).toBe(reservation.updatedAt);
  });

  it('una conservada guarda su fila, su habitación y su stayStatus, con sus personas y su tarifa nuevas', () => {
    const reservation = aReservation();
    const [kept] = reservation.rooms;
    const change = aChange(reservation);
    change.rooms[0] = {
      ...change.rooms[0],
      // Lo que diga el cambio sobre la habitación de una conservada no cuenta: es la misma fila.
      room: { roomId: randomUUID(), roomNumber: '999', categoryRoom: 'SUITE' },
      guestCount: 1,
      rate: rateOf('700000.00', 'Q-nueva'),
    };

    const [room] = reservation.withModification(change).rooms;

    expect(room.snapshot()).toEqual({
      ...kept.snapshot(),
      guestCount: 1,
      rate: rateOf('700000.00', 'Q-nueva'),
    });
  });

  it('una nueva es otra fila, en EXPECTED, con la habitación, las personas y la tarifa del cambio', () => {
    const reservation = aReservation();
    const added = newRoom();

    const changed = reservation.withModification(
      aChange(reservation, {
        rooms: [...aChange(reservation).rooms, added],
      }),
    );

    const room = changed.rooms[1];
    expect(room.id).not.toBe(reservation.rooms[0].id);
    expect(room.snapshot()).toEqual({
      id: room.id,
      roomId: added.room.roomId,
      roomNumber: '305',
      categoryRoom: 'SUITE',
      guestCount: 1,
      rate: rateOf('600000.00', 'Q-305'),
      stayStatus: 'EXPECTED',
    });
    expect(changed.guestCount).toBe(3);
  });

  it('las habitaciones que no están en el cambio se quitan', () => {
    const reservation = aReservation();

    const changed = reservation.withModification(
      aChange(reservation, { rooms: [newRoom()] }),
    );

    expect(changed.rooms.map(({ roomNumber }) => roomNumber)).toEqual(['305']);
  });

  it('el titular corregido guarda su id y su nacionalidad', () => {
    const reservation = aReservation();
    const corrected = {
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'CE' as const,
      documentNumber: 'X123',
      contactPhone: null,
      contactEmail: 'ana@correo.com',
    };

    const changed = reservation.withModification(
      aChange(reservation, { guest: corrected }),
    );

    expect(changed.guest.snapshot()).toEqual({
      ...corrected,
      id: reservation.guest.id,
      nationality: 'Colombia',
    });
  });

  it.each<[string, string | null | undefined, string | null]>([
    ['sin notes quedan las actuales', undefined, 'Llegada tarde'],
    ['con null se borran', null, null],
    ['con otras se reemplazan', 'Llega a las 11 p. m.', 'Llega a las 11 p. m.'],
  ])('%s', (_case, notes, after) => {
    const reservation = aReservation();

    expect(
      reservation.withModification(aChange(reservation, { notes })).notes,
    ).toBe(after);
  });

  it('sin titular en el cambio queda el actual', () => {
    const reservation = aReservation();

    expect(reservation.withModification(aChange(reservation)).guest).toBe(
      reservation.guest,
    );
  });

  it('comprueba las invariantes de restore: fechas, cantidad de habitaciones, repetidas y notes', () => {
    const reservation = aReservation();
    const eleven = Array.from({ length: 11 }, () => newRoom());
    const [kept] = aChange(reservation).rooms;

    expect(() =>
      reservation.withModification(
        aChange(reservation, { endDate: reservation.startDate }),
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: 'INVALID_RESERVATION_DATES' }),
    );
    expect(() =>
      reservation.withModification(aChange(reservation, { rooms: eleven })),
    ).toThrow(expect.objectContaining({ errorCode: 'INVALID_ROOM_COUNT' }));
    expect(() =>
      reservation.withModification(aChange(reservation, { rooms: [] })),
    ).toThrow(expect.objectContaining({ errorCode: 'INVALID_ROOM_COUNT' }));
    expect(() =>
      reservation.withModification(
        aChange(reservation, {
          rooms: [kept, newRoom({ room: { ...kept.room } })],
        }),
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: 'ROOM_ALREADY_IN_RESERVATION' }),
    );
    expect(() =>
      reservation.withModification(
        aChange(reservation, { notes: 'x'.repeat(501) }),
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'NOTES_TOO_LONG' }));
    expect(() =>
      reservation.withModification(
        aChange(reservation, { rooms: [newRoom({ guestCount: 0 })] }),
      ),
    ).toThrow(expect.objectContaining({ errorCode: 'GUEST_COUNT_TOO_LOW' }));
  });

  it('una fila conservada que no es de la reserva es un error del programa', () => {
    const reservation = aReservation();

    expect(() =>
      reservation.withModification(
        aChange(reservation, {
          rooms: [newRoom({ keptRoomId: randomUUID() })],
        }),
      ),
    ).toThrow(/no pertenece a la reserva/);
  });

  it('una reserva de Booking no se modifica así: es un error del programa', () => {
    const reservation = anOtaReservation('ota-1');

    expect(() =>
      reservation.withModification({
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        rooms: [newRoom()],
        guest: undefined,
        notes: undefined,
      }),
    ).toThrow(/es de Booking/);
  });
});
