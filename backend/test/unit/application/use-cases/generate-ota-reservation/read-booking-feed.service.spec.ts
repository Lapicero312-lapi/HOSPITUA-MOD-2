import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingRevision } from '../../../../../src/application/integration/booking-revision.js';
import {
  type BookingFeedPage,
  type ChannexPort,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../../../../src/application/ports/out/channex.port.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import type { OtaConnectionTracker } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import { ReadBookingFeedService } from '../../../../../src/application/use-cases/generate-ota-reservation/read-booking-feed.service.js';
import { anOta } from '../../../../support/builders.js';

const NOW = new Date('2026-11-05T14:30:00.000Z');
const BOOKING = anOta({ name: 'Booking.com' });

/** Una revisión cualquiera del feed: aquí solo importa su `id` y su orden. */
function aRevision(id: string): BookingRevision {
  return { id } as BookingRevision;
}

/** Revisiones `r1`, `r2`, … para llenar páginas. */
function revisions(from: number, count: number): BookingRevision[] {
  return Array.from({ length: count }, (_, i) => aRevision(`r${from + i}`));
}

/** Un Channex que responde, por página, lo pedido (una página o un error); las que faltan, vacías. */
function serviceWith(pages: (BookingFeedPage | Error)[]) {
  const fetchBookingFeed = vi.fn((page: number) => {
    const answer = pages[page - 1] ?? { revisions: [], total: 0 };
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
  const register = vi.fn<ManageOta['register']>().mockResolvedValue(BOOKING);
  const markSynced = vi
    .fn<OtaConnectionTracker['markSynced']>()
    .mockResolvedValue();
  const markDisconnected = vi
    .fn<OtaConnectionTracker['markDisconnected']>()
    .mockResolvedValue();
  const service = new ReadBookingFeedService(
    { fetchBookingFeed } as unknown as ChannexPort,
    { register } as unknown as ManageOta,
    { markSynced, markDisconnected },
    { now: () => NOW, today: () => '2026-11-05' },
  );
  return { service, fetchBookingFeed, register, markSynced, markDisconnected };
}

describe('ReadBookingFeedService (plan, A1 y punto 7)', () => {
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(
      (message: unknown) => {
        warnings.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('todas las páginas responden', () => {
    it('una página: devuelve sus revisiones en orden y llama a markSynced con la hora de la lectura', async () => {
      const {
        service,
        fetchBookingFeed,
        register,
        markSynced,
        markDisconnected,
      } = serviceWith([{ revisions: revisions(1, 2), total: 2 }]);

      await expect(service.read()).resolves.toEqual({
        status: 'READ',
        revisions: [aRevision('r1'), aRevision('r2')],
      });
      expect(fetchBookingFeed.mock.calls).toEqual([[1]]);
      expect(register).toHaveBeenCalledExactlyOnceWith(
        { name: 'Booking.com' },
        NOW,
      );
      expect(markSynced).toHaveBeenCalledExactlyOnceWith(BOOKING.id, NOW);
      expect(markDisconnected).not.toHaveBeenCalled();
    });

    it('sin revisiones también actualiza lastSyncAt (regla 8)', async () => {
      const { service, markSynced } = serviceWith([
        { revisions: [], total: 0 },
      ]);

      await expect(service.read()).resolves.toEqual({
        status: 'READ',
        revisions: [],
      });
      expect(markSynced).toHaveBeenCalledExactlyOnceWith(BOOKING.id, NOW);
    });

    it('pide todas las páginas antes de devolver, en el orden del feed', async () => {
      const { service, fetchBookingFeed } = serviceWith([
        { revisions: revisions(1, 100), total: 250 },
        { revisions: revisions(101, 100), total: 250 },
        { revisions: revisions(201, 50), total: 250 },
      ]);

      const result = await service.read();

      expect(fetchBookingFeed.mock.calls).toEqual([[1], [2], [3]]);
      expect(
        result.status === 'READ' && result.revisions.map((r) => r.id),
      ).toEqual(revisions(1, 250).map((r) => r.id));
    });

    it('con exactamente 100 revisiones pide una sola página', async () => {
      const { service, fetchBookingFeed } = serviceWith([
        { revisions: revisions(1, 100), total: 100 },
      ]);

      await service.read();

      expect(fetchBookingFeed.mock.calls).toEqual([[1]]);
    });

    it('se guía por meta.total: una página con menos de 100 (el adaptador descartó ilegibles) no corta la lectura', async () => {
      const { service, fetchBookingFeed } = serviceWith([
        { revisions: revisions(1, 98), total: 150 },
        { revisions: revisions(101, 50), total: 150 },
      ]);

      const result = await service.read();

      expect(fetchBookingFeed.mock.calls).toEqual([[1], [2]]);
      expect(result.status === 'READ' && result.revisions).toHaveLength(148);
    });

    it('usa el meta.total de la última respuesta: si el total baja, no pide una página de más', async () => {
      const { service, fetchBookingFeed } = serviceWith([
        { revisions: revisions(1, 100), total: 300 },
        { revisions: revisions(101, 90), total: 190 },
      ]);

      await service.read();

      expect(fetchBookingFeed.mock.calls).toEqual([[1], [2]]);
    });
  });

  describe('Channex no responde bien: no procesa nada', () => {
    it.each([401, 403])(
      'con %s pasa la agencia a DISCONNECTED y no llama a markSynced',
      async (status) => {
        const { service, markSynced, markDisconnected } = serviceWith([
          new ChannexUnauthorizedError(status),
        ]);

        await expect(service.read()).resolves.toEqual({ status: 'NOT_READ' });
        expect(markDisconnected).toHaveBeenCalledExactlyOnceWith(
          BOOKING.id,
          NOW,
        );
        expect(markSynced).not.toHaveBeenCalled();
        expect(warnings).toHaveLength(1);
      },
    );

    it('si falla una página después de otras, no devuelve las que ya leyó', async () => {
      const { service, fetchBookingFeed, markSynced } = serviceWith([
        { revisions: revisions(1, 100), total: 150 },
        new ChannexUnavailableError('tiempo agotado'),
      ]);

      await expect(service.read()).resolves.toEqual({ status: 'NOT_READ' });
      expect(fetchBookingFeed).toHaveBeenCalledTimes(2);
      expect(markSynced).not.toHaveBeenCalled();
    });

    it.each<[string, Error]>([
      [
        'un 429 (la pausa la lleva el adaptador)',
        new ChannexRateLimitedError(),
      ],
      ['un 5xx o sin respuesta', new ChannexUnavailableError('503')],
      [
        'otro 4xx, como un 5xx (punto 7)',
        new ChannexRejectedError(404, 'resource_not_found'),
      ],
    ])('con %s no cambia la conexión de la agencia', async (_caso, error) => {
      const { service, register, markSynced, markDisconnected } = serviceWith([
        error,
      ]);

      await expect(service.read()).resolves.toEqual({ status: 'NOT_READ' });
      expect(register).not.toHaveBeenCalled();
      expect(markSynced).not.toHaveBeenCalled();
      expect(markDisconnected).not.toHaveBeenCalled();
      expect(warnings).toEqual([expect.stringContaining(error.message)]);
    });

    it('un error inesperado sale tal cual', async () => {
      const unexpected = new Error('la base de datos no responde');
      const { service } = serviceWith([unexpected]);

      await expect(service.read()).rejects.toBe(unexpected);
    });

    it('un error de la base al marcar la agencia sale tal cual', async () => {
      const { service, markSynced } = serviceWith([
        { revisions: [], total: 0 },
      ]);
      const failure = new Error('sin conexión');
      markSynced.mockRejectedValue(failure);

      await expect(service.read()).rejects.toBe(failure);
    });
  });
});
