import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aDirectReservation,
  aDirectRoom,
  anOtaReservation,
  anOtaRoom,
} from '../../../support/builders.js';

const INVALID = expect.objectContaining({
  errorCode: 'INVALID_STATUS_TRANSITION',
  message: 'La transición de estado no está permitida.',
});

describe('Reservation.withStatus', () => {
  it('cambia el status y el motivo, y no modifica la reserva original', () => {
    const reservation = aDirectReservation({
      rooms: [aDirectRoom({ stayStatus: 'CHECKED_IN' })],
    });

    const changed = reservation.withStatus('IN_PROGRESS', 'CHECK_IN');

    expect(changed.status).toBe('IN_PROGRESS');
    expect(changed.statusReason).toBe('CHECK_IN');
    expect(reservation.status).toBe('ACTIVE');
  });

  it('rechaza una transición que no está en la tabla', () => {
    const completed = aDirectReservation({
      status: 'COMPLETED',
      rooms: [aDirectRoom({ stayStatus: 'CHECKED_OUT' })],
    });

    expect(() => completed.withStatus('ACTIVE', 'CHECK_IN')).toThrow(INVALID);
  });

  it('a IN_PROGRESS solo con una habitación en CHECKED_IN (el Check-In de la primera)', () => {
    expect(() =>
      aDirectReservation().withStatus('IN_PROGRESS', 'CHECK_IN'),
    ).toThrow(INVALID);
  });

  describe('a COMPLETED', () => {
    const inProgress = (
      ...stays: ('CHECKED_IN' | 'CHECKED_OUT' | 'NOT_ARRIVED' | 'EXPECTED')[]
    ) =>
      aDirectReservation({
        status: 'IN_PROGRESS',
        rooms: stays.map((stayStatus) => aDirectRoom({ stayStatus })),
      });

    it('cuando ya no queda ninguna habitación en EXPECTED ni en CHECKED_IN', () => {
      expect(
        inProgress('CHECKED_OUT', 'NOT_ARRIVED').withStatus(
          'COMPLETED',
          'CHECK_OUT',
        ).status,
      ).toBe('COMPLETED');
    });

    it.each([
      ['queda una en CHECKED_IN', ['CHECKED_OUT', 'CHECKED_IN']],
      ['queda una en EXPECTED', ['CHECKED_OUT', 'EXPECTED']],
    ] as const)('se rechaza si %s', (_, stays) => {
      expect(() =>
        inProgress(...stays).withStatus('COMPLETED', 'CHECK_OUT'),
      ).toThrow(INVALID);
    });
  });

  describe('a NO_SHOW (FR-019)', () => {
    it('pasa a NOT_ARRIVED todas sus habitaciones en el mismo cambio', () => {
      const noShow = aDirectReservation({
        rooms: [aDirectRoom(), aDirectRoom()],
      }).withStatus('NO_SHOW', 'DAY_CLOSE_NO_SHOW');

      expect(noShow.rooms.map((room) => room.stayStatus)).toEqual([
        'NOT_ARRIVED',
        'NOT_ARRIVED',
      ]);
      expect(
        noShow.rooms.some((room) => room.blocksInventory(noShow.status)),
      ).toBe(false);
    });

    it('incluye las habitaciones de Booking sin asignar, que no tienen roomId', () => {
      const noShow = anOtaReservation(randomUUID(), {
        rooms: [anOtaRoom(), anOtaRoom({ roomId: null, roomNumber: null })],
      }).withStatus('NO_SHOW', 'DAY_CLOSE_NO_SHOW');

      expect(noShow.rooms.map((room) => room.stayStatus)).toEqual([
        'NOT_ARRIVED',
        'NOT_ARRIVED',
      ]);
    });
  });
});

describe('Reservation.withStayStatus', () => {
  it('cambia solo la habitación indicada', () => {
    const first = aDirectRoom();
    const second = aDirectRoom();
    const reservation = aDirectReservation({ rooms: [first, second] });

    const changed = reservation.withStayStatus(first.roomId!, 'CHECKED_IN');

    expect(changed.rooms.map((room) => room.stayStatus)).toEqual([
      'CHECKED_IN',
      'EXPECTED',
    ]);
    expect(reservation.rooms[0].stayStatus).toBe('EXPECTED');
  });

  it('rechaza una transición de la habitación que no está en la tabla', () => {
    const room = aDirectRoom({ stayStatus: 'CHECKED_OUT' });

    expect(() =>
      aDirectReservation({
        status: 'IN_PROGRESS',
        rooms: [room],
      }).withStayStatus(room.roomId!, 'CHECKED_IN'),
    ).toThrow(INVALID);
  });

  it('una habitación que no es de la reserva es un error del programa', () => {
    expect(() =>
      aDirectReservation().withStayStatus(randomUUID(), 'CHECKED_IN'),
    ).toThrow(/no pertenece/);
  });

  it('al pasar a CHECKED_OUT la habitación deja de ocupar inventario (D3)', () => {
    const room = aDirectRoom({ stayStatus: 'CHECKED_IN' });
    const reservation = aDirectReservation({
      status: 'IN_PROGRESS',
      rooms: [room],
    });

    const changed = reservation.withStayStatus(room.roomId!, 'CHECKED_OUT');

    expect(reservation.rooms[0].blocksInventory('IN_PROGRESS')).toBe(true);
    expect(changed.rooms[0].blocksInventory('IN_PROGRESS')).toBe(false);
  });
});
