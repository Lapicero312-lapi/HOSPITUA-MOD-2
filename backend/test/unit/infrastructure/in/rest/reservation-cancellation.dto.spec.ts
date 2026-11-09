import { describe, expect, it } from 'vitest';
import type { CancellationResult } from '../../../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { toReservationCancellationBody } from '../../../../../src/infrastructure/in/rest/reservation-cancellation.dto.js';

const RESULT: CancellationResult = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'CANCELLED',
  cancellation: {
    cancellationId: '8f1c2d3e-4b5a-4c6d-9e0f-1a2b3c4d5e6f',
    // Las 10:15:20 en Colombia.
    cancellationDate: new Date('2026-10-09T15:15:20Z'),
    channel: 'RECEPTION',
    reason: 'El huésped cambió de planes',
    processedBy: 'laura.mendez',
    status: 'COMPLETED',
  },
};

describe('toReservationCancellationBody (plan de cancel-reservation, contrato A)', () => {
  it('escribe el instante en hora de Colombia, con segundos, y deja lo demás igual', () => {
    expect(toReservationCancellationBody(RESULT)).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      status: 'CANCELLED',
      cancellation: {
        cancellationId: '8f1c2d3e-4b5a-4c6d-9e0f-1a2b3c4d5e6f',
        cancellationDate: '2026-10-09T10:15:20-05:00',
        channel: 'RECEPTION',
        reason: 'El huésped cambió de planes',
        processedBy: 'laura.mendez',
        status: 'COMPLETED',
      },
    });
  });
});
