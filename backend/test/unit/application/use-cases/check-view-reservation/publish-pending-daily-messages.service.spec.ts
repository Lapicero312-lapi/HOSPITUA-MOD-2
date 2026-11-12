import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type {
  DailyListPublisher,
  PublishableDailyMessage,
} from '../../../../../src/application/ports/out/daily-list-publisher.js';
import type {
  DailyMessageRepository,
  UnpublishedDailyMessage,
} from '../../../../../src/application/ports/out/daily-message.repository.js';
import {
  PublishPendingDailyMessagesService,
  UNPUBLISHED_BATCH,
} from '../../../../../src/application/use-cases/check-view-reservation/publish-pending-daily-messages.service.js';

const NOW = new Date('2026-10-09T15:00:00.000Z');
const CLOCK: Clock = { today: () => '2026-10-09', now: () => NOW };
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** Un mensaje pendiente; `n` es su secuencia y forma su `messageId`. */
function aMessage(
  n: number,
  overrides: Partial<UnpublishedDailyMessage> = {},
): UnpublishedDailyMessage {
  return {
    messageId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    operationalDate: '2026-10-09',
    sequenceNumber: n,
    kind: n === 1 ? 'LIST' : 'UPDATE',
    payload: {
      sequenceNumber: n,
      guest: { firstName: 'Ana', lastName: 'Pérez' },
    },
    publishStatus: 'PENDING',
    attempts: 0,
    nextAttemptAt: null,
    ...overrides,
  };
}

/**
 * Un repositorio en memoria: `findUnpublished` devuelve, en orden, los que siguen sin publicar, hasta
 * `limit`. Las llamadas quedan en `calls`, en orden.
 */
function repositoryWith(initial: UnpublishedDailyMessage[]) {
  const pending = [...initial];
  const calls: string[] = [];
  const failures: {
    messageId: string;
    attempts: number;
    status: string;
    nextAttemptAt: Date | null;
  }[] = [];
  const repository: DailyMessageRepository = {
    insert: () => Promise.reject(new Error('no se usa')),
    findUnpublished: vi.fn((limit: number) => {
      calls.push(`find ${limit}`);
      // Un servicio que relee los mismos mensajes sin marcarlos daría vueltas para siempre.
      if (calls.filter((call) => call.startsWith('find')).length > 10) {
        return Promise.reject(new Error('Demasiadas lecturas: no avanza'));
      }
      return Promise.resolve(pending.slice(0, limit));
    }),
    markPublished: vi.fn((messageId: string, publishedAt: Date) => {
      calls.push(`published ${messageId} ${publishedAt.toISOString()}`);
      pending.splice(
        pending.findIndex((message) => message.messageId === messageId),
        1,
      );
      return Promise.resolve();
    }),
    recordFailure: vi.fn((messageId, attempts, status, nextAttemptAt) => {
      calls.push(`failure ${messageId}`);
      failures.push({ messageId, attempts, status, nextAttemptAt });
      return Promise.resolve();
    }),
  };
  return { repository, calls, failures };
}

/** Un publicador que falla con los `messageId` de `failing`; guarda lo que publicó. */
function publisherFailing(...failing: string[]) {
  const sent: PublishableDailyMessage[] = [];
  const publisher: DailyListPublisher = {
    publish: vi.fn((message: PublishableDailyMessage) => {
      sent.push(message);
      return failing.includes(message.messageId)
        ? Promise.reject(new Error('RabbitMQ no confirmó en 5 s'))
        : Promise.resolve();
    }),
  };
  return { publisher, sent };
}

describe('PublishPendingDailyMessages (T026)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const serviceWith = (
    repository: DailyMessageRepository,
    publisher: DailyListPublisher,
  ) => new PublishPendingDailyMessagesService(repository, publisher, CLOCK);

  it('publica en orden de secuencia y marca cada uno apenas sale, con la hora del Clock', async () => {
    const { repository, calls } = repositoryWith([
      aMessage(1),
      aMessage(2),
      aMessage(3),
    ]);
    const { publisher, sent } = publisherFailing();

    const published = await serviceWith(repository, publisher).execute();

    expect(published).toBe(3);
    expect(sent.map(({ messageId }) => messageId)).toEqual([
      aMessage(1).messageId,
      aMessage(2).messageId,
      aMessage(3).messageId,
    ]);
    expect(calls).toEqual([
      `find ${UNPUBLISHED_BATCH}`,
      `published ${aMessage(1).messageId} ${NOW.toISOString()}`,
      `published ${aMessage(2).messageId} ${NOW.toISOString()}`,
      `published ${aMessage(3).messageId} ${NOW.toISOString()}`,
    ]);
  });

  it('publica el payload tal como está guardado, con su messageId y su tipo', async () => {
    const message = aMessage(2);
    const { repository } = repositoryWith([message]);
    const { publisher, sent } = publisherFailing();

    await serviceWith(repository, publisher).execute();

    expect(sent).toEqual([
      {
        messageId: message.messageId,
        kind: 'UPDATE',
        payload: message.payload,
      },
    ]);
  });

  it('sin pendientes no publica nada y devuelve 0', async () => {
    const { repository, calls } = repositoryWith([]);
    const { publisher } = publisherFailing();

    expect(await serviceWith(repository, publisher).execute()).toBe(0);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(calls).toEqual([`find ${UNPUBLISHED_BATCH}`]);
  });

  describe('se detiene en el primero que no puede salir: un mensaje nunca sale antes que uno anterior', () => {
    it('uno FAILED: los siguientes esperan detrás', async () => {
      const { repository } = repositoryWith([
        aMessage(1),
        aMessage(2, { publishStatus: 'FAILED', attempts: 10 }),
        aMessage(3),
      ]);
      const { publisher, sent } = publisherFailing();

      expect(await serviceWith(repository, publisher).execute()).toBe(1);
      expect(sent.map(({ messageId }) => messageId)).toEqual([
        aMessage(1).messageId,
      ]);
      expect(repository.recordFailure).not.toHaveBeenCalled();
    });

    it('uno cuyo siguiente intento todavía no llega: no lo publica ni a los siguientes', async () => {
      const { repository } = repositoryWith([
        aMessage(4, { attempts: 2, nextAttemptAt: later(1) }),
        aMessage(5),
      ]);
      const { publisher } = publisherFailing();

      expect(await serviceWith(repository, publisher).execute()).toBe(0);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('uno cuya hora es exactamente ahora sí sale', async () => {
      const { repository } = repositoryWith([
        aMessage(4, { attempts: 2, nextAttemptAt: NOW }),
      ]);
      const { publisher } = publisherFailing();

      expect(await serviceWith(repository, publisher).execute()).toBe(1);
    });

    it('uno que falla: suma el intento y no publica los siguientes', async () => {
      const { repository, calls } = repositoryWith([
        aMessage(1),
        aMessage(2),
        aMessage(3),
      ]);
      const { publisher } = publisherFailing(aMessage(2).messageId);

      expect(await serviceWith(repository, publisher).execute()).toBe(1);
      expect(publisher.publish).toHaveBeenCalledTimes(2);
      expect(calls.at(-1)).toBe(`failure ${aMessage(2).messageId}`);
      expect(repository.markPublished).toHaveBeenCalledTimes(1);
    });
  });

  describe('reintentos con espera creciente (5 s, 15 s, 45 s, 2 min y después 5 min)', () => {
    it.each([
      [0, 1, 5_000],
      [1, 2, 15_000],
      [2, 3, 45_000],
      [3, 4, 120_000],
      [4, 5, 300_000],
      [8, 9, 300_000],
    ])(
      'con %i intentos previos guarda %i y el siguiente intento %i ms después, en PENDING',
      async (previous, attempts, delay) => {
        const message = aMessage(2, { attempts: previous });
        const { repository, failures } = repositoryWith([message]);
        const { publisher } = publisherFailing(message.messageId);

        await serviceWith(repository, publisher).execute();

        expect(failures).toEqual([
          {
            messageId: message.messageId,
            attempts,
            status: 'PENDING',
            nextAttemptAt: later(delay),
          },
        ]);
        expect(error).not.toHaveBeenCalled();
      },
    );

    it('el fallo queda en el log con el messageId y la secuencia, sin el payload', async () => {
      const message = aMessage(2);
      const { repository } = repositoryWith([message]);
      const { publisher } = publisherFailing(message.messageId);

      await serviceWith(repository, publisher).execute();

      expect(warn).toHaveBeenCalledTimes(1);
      const [text] = warn.mock.calls[0] as [string];
      expect(text).toContain(message.messageId);
      expect(text).toContain('secuencia 2');
      expect(text).toContain('RabbitMQ no confirmó en 5 s');
      expect(text).not.toContain('Ana');
      expect(text).not.toContain('Pérez');
    });
  });

  describe('en el décimo intento fallido', () => {
    it('pasa a FAILED, sin siguiente intento, y deja la alerta con el messageId, la operationalDate y el sequenceNumber, sin el payload', async () => {
      const message = aMessage(7, { attempts: 9, nextAttemptAt: NOW });
      const { repository, failures } = repositoryWith([message, aMessage(8)]);
      const { publisher } = publisherFailing(message.messageId);

      expect(await serviceWith(repository, publisher).execute()).toBe(0);

      expect(failures).toEqual([
        {
          messageId: message.messageId,
          attempts: 10,
          status: 'FAILED',
          nextAttemptAt: null,
        },
      ]);
      expect(error).toHaveBeenCalledTimes(1);
      const [text] = error.mock.calls[0] as [string];
      expect(text).toContain(message.messageId);
      expect(text).toContain('2026-10-09');
      expect(text).toContain('secuencia 7');
      expect(text).not.toContain('Ana');
      expect(text).not.toContain('Pérez');
      expect(publisher.publish).toHaveBeenCalledTimes(1);
    });
  });

  it('un error de la publicación no se propaga (FR-020)', async () => {
    const { repository } = repositoryWith([aMessage(1)]);
    const { publisher } = publisherFailing(aMessage(1).messageId);

    await expect(serviceWith(repository, publisher).execute()).resolves.toBe(0);
  });

  it('si publicó los 100 de un lote, vuelve a leer y sigue con los siguientes', async () => {
    const messages = Array.from({ length: UNPUBLISHED_BATCH + 5 }, (_, index) =>
      aMessage(index + 1),
    );
    const { repository, calls } = repositoryWith(messages);
    const { publisher } = publisherFailing();

    expect(await serviceWith(repository, publisher).execute()).toBe(
      UNPUBLISHED_BATCH + 5,
    );
    expect(calls.filter((call) => call.startsWith('find'))).toHaveLength(2);
  });

  it('con un lote incompleto no vuelve a leer', async () => {
    const { repository, calls } = repositoryWith([aMessage(1), aMessage(2)]);
    const { publisher } = publisherFailing();

    await serviceWith(repository, publisher).execute();

    expect(calls.filter((call) => call.startsWith('find'))).toHaveLength(1);
  });
});
