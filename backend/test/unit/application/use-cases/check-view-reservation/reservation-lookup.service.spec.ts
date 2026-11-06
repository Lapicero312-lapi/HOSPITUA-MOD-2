import { describe, expect, it, vi } from 'vitest';
import type {
  BlockingRoom,
  ReservationQueryPort,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import { ReservationLookupService } from '../../../../../src/application/use-cases/check-view-reservation/reservation-lookup.service.js';

const ROOM_201 = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';

function lookupAnswering(blocking: BlockingRoom[]) {
  const findBlockingRooms = vi.fn(() => Promise.resolve(blocking));
  const query = { findBlockingRooms } as ReservationQueryPort;
  return { lookup: new ReservationLookupService(query), findBlockingRooms };
}

describe('ReservationLookup.findBlockingRooms', () => {
  it('pide a ReservationQueryPort las habitaciones, el rango y la reserva a excluir, y devuelve lo que responde', async () => {
    const blocking = [{ roomId: ROOM_201, reservationRef: 'RSV-0A1B2C3D' }];
    const { lookup, findBlockingRooms } = lookupAnswering(blocking);

    await expect(
      lookup.findBlockingRooms(
        [ROOM_201],
        '2026-11-10',
        '2026-11-12',
        'RSV-9F8E7D6C',
      ),
    ).resolves.toEqual(blocking);
    expect(findBlockingRooms).toHaveBeenCalledWith(
      [ROOM_201],
      '2026-11-10',
      '2026-11-12',
      'RSV-9F8E7D6C',
    );
  });

  it('sin reserva a excluir, la pide sin ella', async () => {
    const { lookup, findBlockingRooms } = lookupAnswering([]);

    await lookup.findBlockingRooms([ROOM_201], '2026-11-10', '2026-11-12');

    expect(findBlockingRooms).toHaveBeenCalledWith(
      [ROOM_201],
      '2026-11-10',
      '2026-11-12',
      undefined,
    );
  });

  it('sin habitaciones devuelve [] sin consultar la base', async () => {
    const { lookup, findBlockingRooms } = lookupAnswering([
      { roomId: ROOM_201, reservationRef: 'RSV-0A1B2C3D' },
    ]);

    await expect(
      lookup.findBlockingRooms([], '2026-11-10', '2026-11-12'),
    ).resolves.toEqual([]);
    expect(findBlockingRooms).not.toHaveBeenCalled();
  });
});
