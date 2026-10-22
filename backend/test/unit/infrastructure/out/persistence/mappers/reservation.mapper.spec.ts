import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decimalText } from '../../../../../../src/infrastructure/out/persistence/mappers/decimal-text.js';
import {
  reservationToDomain,
  reservationToRows,
} from '../../../../../../src/infrastructure/out/persistence/mappers/reservation.mapper.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOtaReservation,
  anOtaRoom,
} from '../../../../../support/builders.js';

describe('reservationToRows', () => {
  it('una reserva directa: comisión 0, sin datos de agencia y la tarifa en cada habitación', () => {
    const reservation = aDirectReservation();
    const { reservation: row, rooms, guest } = reservationToRows(reservation);

    expect(row).toMatchObject({
      source: 'DIRECT',
      otaId: null,
      externalConfirmationCode: null,
      grossAmount: null,
      currency: null,
      commissionPercentage: '0',
      commissionAmount: '0',
      commissionStatus: null,
      guestCount: 2,
    });
    expect(rooms[0]).toMatchObject({
      reservationId: reservation.id,
      roomGrossAmount: '530000',
      currency: 'COP',
    });
    expect(guest.reservationId).toBe(reservation.id);
  });

  it('cada habitación lleva la copia de las fechas de la reserva y su blocks_inventory (D3)', () => {
    const reservation = aDirectReservation({
      status: 'IN_PROGRESS',
      rooms: [
        aDirectRoom({ stayStatus: 'CHECKED_IN' }),
        aDirectRoom({ stayStatus: 'CHECKED_OUT' }),
      ],
    });

    const { rooms } = reservationToRows(reservation);

    expect(rooms.map((room) => [room.startDate, room.endDate])).toEqual([
      ['2026-11-10', '2026-11-12'],
      ['2026-11-10', '2026-11-12'],
    ]);
    expect(rooms.map((room) => room.blocksInventory)).toEqual([true, false]);
  });

  it('una reserva OTA: agencia, valor, comisión y una habitación sin asignar que no bloquea', () => {
    const otaId = randomUUID();
    const { reservation: row, rooms } = reservationToRows(
      anOtaReservation(otaId, {
        rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
      }),
    );

    expect(row).toMatchObject({
      otaId,
      externalConfirmationCode: '4417829013',
      grossAmount: '400',
      currency: 'USD',
      commissionPercentage: '15',
      commissionAmount: '60',
      commissionStatus: 'CALCULATED',
      conflictReason: 'NO_ROOM_AVAILABLE',
    });
    expect(rooms[0]).toMatchObject({
      roomId: null,
      roomGrossAmount: null,
      blocksInventory: false,
    });
  });
});

describe('reservationToDomain', () => {
  it.each([
    ['directa', () => aDirectReservation()],
    ['OTA', () => anOtaReservation(randomUUID())],
  ])('una reserva %s guardada y leída es la misma', (_, build) => {
    const reservation = build();
    const { reservation: row, rooms, guest } = reservationToRows(reservation);
    Object.assign(row, {
      rooms,
      guest,
      createdAt: new Date('2026-10-09T14:14:00.000Z'),
      updatedAt: '2026-10-09 09:14:00.123456-05',
    });

    const read = reservationToDomain(row);

    expect(read.snapshot()).toEqual({
      ...reservation.snapshot(),
      createdAt: new Date('2026-10-09T14:14:00.000Z'),
      updatedAt: '2026-10-09 09:14:00.123456-05',
    });
  });
});

describe('decimalText', () => {
  it.each([
    ['15.00', '15'],
    ['530000.00', '530000'],
    ['12.50', '12.5'],
    ['0.00', '0'],
  ])('%s se lee como %s, igual que Money', (value, expected) => {
    expect(decimalText(value)).toBe(expected);
  });
});
