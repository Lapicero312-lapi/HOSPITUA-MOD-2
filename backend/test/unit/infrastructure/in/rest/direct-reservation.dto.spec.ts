import { describe, expect, it } from 'vitest';
import type { DirectReservationPreview } from '../../../../../src/application/use-cases/generate-direct-reservation/ports/in/preview-direct-reservation.port.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { toDirectReservationPreviewBody } from '../../../../../src/infrastructure/in/rest/direct-reservation.dto.js';
import { aRoomAvailability } from '../../../../support/room-availability.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

const ROOM_203 = {
  id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  roomNumber: '203',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

const DATES = { startDate: '2026-10-12', endDate: '2026-10-15' };

const aQuote = (key: string) => ({
  key,
  quoteId: `quote-${key}`,
  currency: 'COP',
  nightlyRates: [
    { date: '2026-10-12', rate: Money.of('250000.00', 'COP') },
    { date: '2026-10-13', rate: Money.of('250000.00', 'COP') },
    { date: '2026-10-14', rate: Money.of('250000.00', 'COP') },
  ],
  lodgingAmount: Money.of('750000.00', 'COP'),
});

/** La vista previa del ejemplo de A: la 201 y la 202 asignadas y la 203 reservada. */
const PREVIEW: DirectReservationPreview = {
  categoryRoom: 'DOBLE',
  availability: {
    ...DATES,
    rooms: [
      aRoomAvailability(ROOM_201),
      aRoomAvailability(ROOM_202),
      aRoomAvailability(ROOM_203, { available: false, reason: 'RESERVED' }),
    ],
  },
  assignedRooms: [
    { position: 1, room: ROOM_201, guestCount: 2 },
    { position: 2, room: ROOM_202, guestCount: 2 },
  ],
  quoteRequests: [
    { key: '1', categoryRoom: 'DOBLE', ...DATES },
    { key: '2', categoryRoom: 'DOBLE', ...DATES },
  ],
  quotes: [aQuote('1'), aQuote('2')],
  guestCount: 4,
};

const NIGHTLY_RATES = [
  { date: '2026-10-12', rate: { amount: '250000.00', currency: 'COP' } },
  { date: '2026-10-13', rate: { amount: '250000.00', currency: 'COP' } },
  { date: '2026-10-14', rate: { amount: '250000.00', currency: 'COP' } },
];

describe('toDirectReservationPreviewBody (plan de generate-direct-reservation, A)', () => {
  it('arma la respuesta del ejemplo de A con los DTO compartidos availability y quotes', () => {
    expect(toDirectReservationPreviewBody(PREVIEW)).toEqual({
      availability: {
        ...DATES,
        categoryRoom: 'DOBLE',
        availableCount: 2,
        rooms: [
          {
            roomId: ROOM_201.id,
            roomNumber: '201',
            available: true,
            reason: null,
            message: null,
          },
          {
            roomId: ROOM_202.id,
            roomNumber: '202',
            available: true,
            reason: null,
            message: null,
          },
          {
            roomId: ROOM_203.id,
            roomNumber: '203',
            available: false,
            reason: 'RESERVED',
            message: 'La habitación ya está reservada en esas fechas.',
          },
        ],
      },
      assignedRooms: [
        {
          position: 1,
          roomId: ROOM_201.id,
          roomNumber: '201',
          maxCapacity: 2,
          guestCount: 2,
        },
        {
          position: 2,
          roomId: ROOM_202.id,
          roomNumber: '202',
          maxCapacity: 3,
          guestCount: 2,
        },
      ],
      quotes: {
        rooms: [
          {
            key: '1',
            categoryRoom: 'DOBLE',
            nights: 3,
            nightlyRates: NIGHTLY_RATES,
            lodgingAmount: { amount: '750000.00', currency: 'COP' },
          },
          {
            key: '2',
            categoryRoom: 'DOBLE',
            nights: 3,
            nightlyRates: NIGHTLY_RATES,
            lodgingAmount: { amount: '750000.00', currency: 'COP' },
          },
        ],
        total: { amount: '1500000.00', currency: 'COP' },
      },
      reservation: { guestCount: 4 },
    });
  });

  it('el quoteId no sale hacia la pantalla', () => {
    expect(JSON.stringify(toDirectReservationPreviewBody(PREVIEW))).not.toMatch(
      /quote-|quoteId/,
    );
  });

  it('de cada habitación asignada salen solo los campos de A, sin su categoría', () => {
    const [assigned] = toDirectReservationPreviewBody(PREVIEW).assignedRooms;

    expect(Object.keys(assigned).sort()).toEqual([
      'guestCount',
      'maxCapacity',
      'position',
      'roomId',
      'roomNumber',
    ]);
  });
});
