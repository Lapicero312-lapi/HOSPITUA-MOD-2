import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannexPort,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../../../../src/application/ports/out/channex.port.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type {
  OtaNoShowReportRepository,
  PendingNoShow,
} from '../../../../../src/application/ports/out/ota-no-show-report.repository.js';
import { PublishPendingNoShowsService } from '../../../../../src/application/use-cases/generate-ota-reservation/publish-pending-no-shows.service.js';

const NOW = new Date('2026-10-10T05:01:00.000Z');

/** Tres reportes pendientes, del más antiguo al más reciente. */
const PENDING: PendingNoShow[] = ['a', 'b', 'c'].map((letter, index) => ({
  reservationId: `reserva-${letter}`,
  bookingId: `booking-${letter}`,
  attempts: 0,
  createdAt: new Date(Date.UTC(2026, 9, 10, 5, 0, index)),
}));

let warnings: string[];
let infos: string[];

/** El envío con Channex respondiendo, por cada `bookingId`, lo que diga `answers` (o 200). */
function aPublisher(
  pending: PendingNoShow[] = PENDING,
  answers: Record<string, Error> = {},
) {
  const reportNoShow = vi.fn((bookingId: string) => {
    const answer = answers[bookingId];
    return answer === undefined ? Promise.resolve() : Promise.reject(answer);
  });
  const reports = {
    findPending: vi.fn().mockResolvedValue(pending),
    markReported: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
    countAttempt: vi.fn().mockResolvedValue(undefined),
  };
  const publisher = new PublishPendingNoShowsService(
    reports as unknown as OtaNoShowReportRepository,
    { reportNoShow } as unknown as ChannexPort,
    { now: () => NOW } as unknown as Clock,
  );
  return { publisher, reportNoShow, reports };
}

describe('PublishPendingNoShowsService (plan de generate-ota-reservation, A3 y punto 8; FR-011)', () => {
  beforeEach(() => {
    warnings = [];
    infos = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      infos.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('200: reporta cada pendiente, del más antiguo al más reciente, y lo deja REPORTED con la hora del reloj', async () => {
    const { publisher, reportNoShow, reports } = aPublisher();

    await expect(publisher.publish()).resolves.toEqual({
      reported: 3,
      rejected: 0,
      pending: 0,
    });

    expect(reportNoShow.mock.calls.map(([bookingId]) => bookingId)).toEqual([
      'booking-a',
      'booking-b',
      'booking-c',
    ]);
    expect(reports.markReported.mock.calls).toEqual([
      ['reserva-a', NOW],
      ['reserva-b', NOW],
      ['reserva-c', NOW],
    ]);
    expect(reports.countAttempt).not.toHaveBeenCalled();
    expect(infos).toEqual([
      'No-shows a Channex: 3 reportados, 0 rechazados y 0 pendientes.',
    ]);
  });

  it.each([404, 422])(
    '%i: lo deja REJECTED, no lo reintenta y sigue con los demás',
    async (status) => {
      const { publisher, reports } = aPublisher(PENDING, {
        'booking-b': new ChannexRejectedError(
          status,
          status === 404 ? 'resource_not_found' : 'method_not_supported',
        ),
      });

      await expect(publisher.publish()).resolves.toEqual({
        reported: 2,
        rejected: 1,
        pending: 0,
      });

      expect(reports.markRejected).toHaveBeenCalledExactlyOnceWith('reserva-b');
      expect(reports.markReported.mock.calls.map(([id]) => id)).toEqual([
        'reserva-a',
        'reserva-c',
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('reserva-b');
      expect(warnings[0]).toContain(String(status));
      expect(warnings[0]).toContain('No se vuelve a intentar');
    },
  );

  it('otro 4xx: suma el intento, lo deja PENDING para el ciclo siguiente y sigue con los demás', async () => {
    const { publisher, reports } = aPublisher(PENDING, {
      'booking-a': new ChannexRejectedError(400, 'validation_error'),
    });

    await expect(publisher.publish()).resolves.toEqual({
      reported: 2,
      rejected: 0,
      pending: 1,
    });

    expect(reports.countAttempt).toHaveBeenCalledExactlyOnceWith('reserva-a');
    expect(reports.markRejected).not.toHaveBeenCalled();
    expect(reports.markReported).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['401', new ChannexUnauthorizedError(401)],
    ['403', new ChannexUnauthorizedError(403)],
    ['429', new ChannexRateLimitedError()],
    ['5xx', new ChannexUnavailableError('respondió 503')],
    ['sin respuesta', new ChannexUnavailableError('tiempo agotado')],
  ])(
    '%s: suma el intento y se detiene; ese y los siguientes quedan PENDING para el ciclo siguiente',
    async (_case, error) => {
      const { publisher, reportNoShow, reports } = aPublisher(PENDING, {
        'booking-b': error,
      });

      await expect(publisher.publish()).resolves.toEqual({
        reported: 1,
        rejected: 0,
        pending: 2,
      });

      expect(reportNoShow.mock.calls.map(([bookingId]) => bookingId)).toEqual([
        'booking-a',
        'booking-b',
      ]);
      expect(reports.countAttempt).toHaveBeenCalledExactlyOnceWith('reserva-b');
      expect(reports.markReported).toHaveBeenCalledExactlyOnceWith(
        'reserva-a',
        NOW,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('reserva-b');
    },
  );

  it('un error que no es de Channex sale: lo maneja ChannexSyncJob', async () => {
    const { publisher } = aPublisher(PENDING, {
      'booking-a': new Error('la base de datos no responde'),
    });

    await expect(publisher.publish()).rejects.toThrow(
      'la base de datos no responde',
    );
  });

  it('sin pendientes no llama a Channex ni deja nada en el log', async () => {
    const { publisher, reportNoShow } = aPublisher([]);

    await expect(publisher.publish()).resolves.toEqual({
      reported: 0,
      rejected: 0,
      pending: 0,
    });

    expect(reportNoShow).not.toHaveBeenCalled();
    expect(infos).toEqual([]);
  });
});
