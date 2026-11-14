import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingRevision } from '../../../../../src/application/integration/booking-revision.js';
import type { ChannexPort } from '../../../../../src/application/ports/out/channex.port.js';
import type {
  OtaBookingRevisionRepository,
  ProcessedRevision,
} from '../../../../../src/application/ports/out/ota-booking-revision.repository.js';
import { ProcessBookingFeedService } from '../../../../../src/application/use-cases/generate-ota-reservation/process-booking-feed.service.js';
import type {
  ProcessBookingRevision,
  RevisionOutcome,
} from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/process-booking-revision.port.js';
import type {
  BookingFeedRead,
  ReadBookingFeed,
} from '../../../../../src/application/use-cases/generate-ota-reservation/ports/in/read-booking-feed.port.js';

/** Una revisión del feed: solo importan su `id` y su `bookingId`. */
const revision = (id: string, bookingId: string): BookingRevision =>
  ({
    id,
    bookingId,
    customer: { name: 'Ana', surname: 'Pérez', mail: 'ana@correo.com' },
  }) as unknown as BookingRevision;

const pendingAck = (revisionId: string): ProcessedRevision =>
  ({ revisionId }) as ProcessedRevision;

const ACKNOWLEDGE: RevisionOutcome = { kind: 'ACKNOWLEDGE' };

describe('ProcessBookingFeed (plan de generate-ota-reservation, punto 9; T007)', () => {
  /** Todo lo que pasa, en orden: para comprobar que el ack va después de procesar. */
  let calls: string[];
  let pending: ProcessedRevision[];
  let read: BookingFeedRead;
  let outcomes: Record<string, () => Promise<RevisionOutcome>>;
  let failingAcks: Set<string>;
  let markAcked: ReturnType<typeof vi.fn>;
  let ack: ReturnType<typeof vi.fn>;
  let process: ReturnType<typeof vi.fn>;
  let service: ProcessBookingFeedService;

  beforeEach(() => {
    calls = [];
    pending = [];
    read = { status: 'READ', revisions: [] };
    outcomes = {};
    failingAcks = new Set();
    markAcked = vi.fn((id: string) => {
      calls.push(`markAcked ${id}`);
      return Promise.resolve();
    });
    ack = vi.fn((id: string) => {
      calls.push(`ack ${id}`);
      return failingAcks.has(id)
        ? Promise.reject(new Error('Channex no responde'))
        : Promise.resolve();
    });
    process = vi.fn((r: BookingRevision) => {
      calls.push(`process ${r.id}`);
      return (outcomes[r.id] ?? (() => Promise.resolve(ACKNOWLEDGE)))();
    });
    service = new ProcessBookingFeedService(
      {
        findPendingAck: () => {
          calls.push('findPendingAck');
          return Promise.resolve(pending);
        },
        markAcked,
      } as unknown as OtaBookingRevisionRepository,
      { ackBookingRevision: ack } as unknown as ChannexPort,
      {
        read: () => {
          calls.push('read');
          return Promise.resolve(read);
        },
      } as ReadBookingFeed,
      { process } as unknown as ProcessBookingRevision,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('primero repite los ack pendientes, después lee el feed', async () => {
    pending = [pendingAck('r-viejo-1'), pendingAck('r-viejo-2')];

    await service.run();

    expect(calls).toEqual([
      'findPendingAck',
      'ack r-viejo-1',
      'markAcked r-viejo-1',
      'ack r-viejo-2',
      'markAcked r-viejo-2',
      'read',
    ]);
  });

  it('procesa en el orden del feed y confirma cada ACKNOWLEDGE después de procesarla', async () => {
    read = {
      status: 'READ',
      revisions: [revision('r1', 'b1'), revision('r2', 'b2')],
    };

    // Leyó el feed: ChannexSyncJob puede enviar la disponibilidad (B3 de configure-ota, FR-007).
    await expect(service.run()).resolves.toBe(true);

    expect(calls).toEqual([
      'findPendingAck',
      'read',
      'process r1',
      'ack r1',
      'markAcked r1',
      'process r2',
      'ack r2',
      'markAcked r2',
    ]);
  });

  it('si no se pudo leer el feed, no procesa nada y devuelve false (sin disponibilidad en ese ciclo, FR-007)', async () => {
    read = { status: 'NOT_READ' };

    await expect(service.run()).resolves.toBe(false);

    expect(process).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });

  it('un RETRY no se confirma, y las siguientes de esa misma reserva esperan; las de otras siguen (regla 3)', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    read = {
      status: 'READ',
      revisions: [
        revision('r1', 'b1'),
        revision('r2', 'b2'),
        revision('r3', 'b1'),
      ],
    };
    outcomes.r1 = () =>
      Promise.resolve({ kind: 'RETRY', reason: 'revisión r1: sin relación' });

    // Leyó el feed: una revisión que no se guardó no cambia el resultado (caso conocido de B3).
    await expect(service.run()).resolves.toBe(true);

    expect(process.mock.calls.map(([r]) => (r as BookingRevision).id)).toEqual([
      'r1',
      'r2',
    ]);
    expect(ack.mock.calls).toEqual([['r2']]);
    expect(String(warn.mock.calls[0][0])).toContain(
      'revisión r1: sin relación',
    );
  });

  it('un error inesperado se registra sin datos personales, no se confirma y las de esa reserva esperan', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    read = {
      status: 'READ',
      revisions: [
        revision('r1', 'b1'),
        revision('r2', 'b1'),
        revision('r3', 'b2'),
      ],
    };
    outcomes.r1 = () =>
      Promise.reject(new TypeError('Ana Pérez ana@correo.com no cabe'));

    await expect(service.run()).resolves.toBe(true);

    expect(process.mock.calls.map(([r]) => (r as BookingRevision).id)).toEqual([
      'r1',
      'r3',
    ]);
    expect(ack.mock.calls).toEqual([['r3']]);
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain('r1');
    expect(line).toContain('TypeError');
    expect(line).not.toContain('Ana');
    expect(line).not.toContain('ana@correo.com');
  });

  it('si el ack falla, no marca acked_at y sigue con la siguiente (se repite en el ciclo siguiente)', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    read = {
      status: 'READ',
      revisions: [revision('r1', 'b1'), revision('r2', 'b2')],
    };
    failingAcks.add('r1');

    await service.run();

    expect(markAcked.mock.calls).toEqual([['r2']]);
    expect(process).toHaveBeenCalledTimes(2);
  });

  it('un ack pendiente que vuelve a fallar no detiene la lectura del feed', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    pending = [pendingAck('r-viejo')];
    failingAcks.add('r-viejo');
    read = { status: 'READ', revisions: [revision('r1', 'b1')] };

    await service.run();

    expect(markAcked.mock.calls).toEqual([['r1']]);
  });
});
