import { describe, expect, it, vi } from 'vitest';
import type {
  ReservationQueryPort,
  StayRangeReservation,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import { FindReservationsByStayRangeService } from '../../../../../src/application/use-cases/check-view-reservation/find-reservations-by-stay-range.service.js';

const ROOM_ID = 'a4c2e6f8-1b3d-4e5f-8a7b-9c0d1e2f3a4b';

const RESERVATION: StayRangeReservation = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'ACTIVE',
  startDate: '2026-10-23',
  endDate: '2026-10-25',
  rooms: [{ roomId: ROOM_ID, roomNumber: '204', categoryRoom: 'DOBLE' }],
};

function aService(found: StayRangeReservation[]) {
  const findByStayRange = vi
    .fn<ReservationQueryPort['findByStayRange']>()
    .mockResolvedValue(found);
  return {
    service: new FindReservationsByStayRangeService({
      findByStayRange,
    } as unknown as ReservationQueryPort),
    findByStayRange,
  };
}

describe('FindReservationsByStayRange (plan de check-view-reservation, C5; T033)', () => {
  it('consulta con las dos fechas y la habitación, y devuelve las reservas tal como las entrega la consulta', async () => {
    const { service, findByStayRange } = aService([RESERVATION]);

    await expect(
      service.execute({
        dateFrom: '2026-10-20',
        dateTo: '2026-10-25',
        roomId: ROOM_ID,
      }),
    ).resolves.toEqual([RESERVATION]);
    expect(findByStayRange).toHaveBeenCalledExactlyOnceWith(
      '2026-10-20',
      '2026-10-25',
      ROOM_ID,
    );
  });

  it('sin habitación consulta con roomId en null', async () => {
    const { service, findByStayRange } = aService([]);

    await expect(
      service.execute({
        dateFrom: '2026-10-20',
        dateTo: '2026-10-25',
        roomId: null,
      }),
    ).resolves.toEqual([]);
    expect(findByStayRange).toHaveBeenCalledExactlyOnceWith(
      '2026-10-20',
      '2026-10-25',
      null,
    );
  });
});
