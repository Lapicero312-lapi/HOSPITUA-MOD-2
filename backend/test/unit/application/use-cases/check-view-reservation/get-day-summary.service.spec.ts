import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { ReservationQueryPort } from '../../../../../src/application/ports/out/reservation-query.port.js';
import { GetDaySummaryService } from '../../../../../src/application/use-cases/check-view-reservation/get-day-summary.service.js';

function serviceWith(expectedArrivals: number, expectedDepartures: number) {
  const countExpectedArrivalsAndDepartures = vi.fn(() =>
    Promise.resolve({ expectedArrivals, expectedDepartures }),
  );
  // Las 21:00 del 9 en Colombia: en UTC ya es el 10, y el día operativo es el del reloj del hotel.
  const clock = {
    today: () => '2026-10-09',
    now: () => new Date('2026-10-10T02:00:00Z'),
  } satisfies Clock;
  const service = new GetDaySummaryService(
    {
      countExpectedArrivalsAndDepartures,
    } as unknown as ReservationQueryPort,
    clock,
  );
  return { service, countExpectedArrivalsAndDepartures };
}

describe('GetDaySummary (plan de check-view-reservation, C2, T012)', () => {
  it('devuelve el ejemplo de C2: el día operativo del reloj y las dos cifras', async () => {
    const { service } = serviceWith(2, 0);

    await expect(service.execute()).resolves.toEqual({
      operationalDate: '2026-10-09',
      expectedArrivals: 2,
      expectedDepartures: 0,
    });
  });

  it('cuenta las del día operativo del reloj, una sola vez', async () => {
    const { service, countExpectedArrivalsAndDepartures } = serviceWith(0, 1);

    await service.execute();

    expect(countExpectedArrivalsAndDepartures).toHaveBeenCalledTimes(1);
    expect(countExpectedArrivalsAndDepartures).toHaveBeenCalledWith(
      '2026-10-09',
    );
  });
});
