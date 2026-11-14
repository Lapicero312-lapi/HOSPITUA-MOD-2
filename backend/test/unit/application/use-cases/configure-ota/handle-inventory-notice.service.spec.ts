import { describe, expect, it, vi } from 'vitest';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { ExclusiveRunner } from '../../../../../src/application/ports/out/exclusive-runner.js';
import type { ProcessedMessageRepository } from '../../../../../src/application/ports/out/processed-message.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import { CHANNEX_LOCK } from '../../../../../src/application/use-cases/configure-ota/channex-lock.js';
import { HandleInventoryNoticeService } from '../../../../../src/application/use-cases/configure-ota/handle-inventory-notice.service.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import {
  ChannexLockBusyError,
  type InventoryNotice,
} from '../../../../../src/application/use-cases/configure-ota/ports/in/handle-inventory-notice.port.js';
import type {
  RoomTypeSync,
  SyncRoomTypes,
} from '../../../../../src/application/use-cases/configure-ota/ports/in/sync-room-types.port.js';

const TX = { tx: 'la del aviso' } as unknown as Transaction;
const TODAY = '2026-11-10';
const QUEUE = 'm2.habitacion.inventario.queue';

/** El ejemplo de E2 del plan: la 305 pasa de DOBLE a SUITE. */
const notice = (changes: Partial<InventoryNotice> = {}): InventoryNotice => ({
  messageId: '0b6f2d14-8e3a-4c5b-b7d9-6a1e3f9c2d57',
  sequenceNumber: 4,
  queue: QUEUE,
  action: 'UPDATED',
  roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  categoryRoom: 'SUITE',
  previousCategoryRoom: 'DOBLE',
  ...changes,
});

function aService(
  options: {
    /** Lo que responde `isProcessed`, en orden: antes de sincronizar y dentro de la transacción. */
    processed?: boolean[];
    ready?: boolean;
    ariDays?: number | null;
    lockBusy?: boolean;
    sync?: RoomTypeSync;
  } = {},
) {
  const calls: string[] = [];
  const run = vi.fn((work: (tx: Transaction) => Promise<unknown>) => {
    calls.push('BEGIN');
    return work(TX).then((result) => {
      calls.push('COMMIT');
      return result;
    });
  });
  const answers = [...(options.processed ?? [])];
  const isProcessed = vi.fn(() => Promise.resolve(answers.shift() ?? false));
  const recordMessage = vi.fn(() => {
    calls.push('processed');
    return Promise.resolve();
  });
  const record = vi.fn<AriChangeRecorder['record']>(() => {
    calls.push('ari');
    return Promise.resolve();
  });
  const sync = vi.fn<SyncRoomTypes['sync']>(() => {
    calls.push('sync');
    return Promise.resolve(options.sync ?? { status: 'SYNCED', created: [] });
  });
  const runExclusive = vi.fn<ExclusiveRunner['runExclusive']>(
    async (_name, work) => {
      if (options.lockBusy === true) {
        return false;
      }
      calls.push('lock');
      await work();
      calls.push('unlock');
      return true;
    },
  );
  const ariDays = options.ariDays === undefined ? 90 : options.ariDays;
  const channex = {
    isReady: () => options.ready ?? true,
    settings: () =>
      ariDays === null
        ? null
        : {
            baseUrl: 'https://staging.channex.io',
            propertyId: '716305c4-561a-4561-a187-7f5b8aeb5920',
            syncIntervalSeconds: 30,
            ariDays,
          },
  } as unknown as ChannexSetupState;
  const clock: Clock = { today: () => TODAY, now: () => new Date() };
  const service = new HandleInventoryNoticeService(
    { run } as unknown as TransactionRunner,
    {
      isProcessed,
      record: recordMessage,
    } as unknown as ProcessedMessageRepository,
    { record },
    { sync },
    { runExclusive },
    channex,
    clock,
  );
  return {
    service,
    calls,
    record,
    recordMessage,
    sync,
    runExclusive,
    isProcessed,
  };
}

describe('HandleInventoryNotice (E2 de configure-ota; T012b)', () => {
  it('el ejemplo de E2 (UPDATED): sincroniza con el bloqueo y después anota los 90 días de las dos categorías', async () => {
    const { service, record, calls, runExclusive } = aService();

    expect(await service.execute(notice())).toBe('APPLIED');

    expect(runExclusive).toHaveBeenCalledExactlyOnceWith(
      CHANNEX_LOCK,
      expect.any(Function),
    );
    expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
      { categoryRoom: 'SUITE', dateFrom: '2026-11-10', dateTo: '2027-02-08' },
      { categoryRoom: 'DOBLE', dateFrom: '2026-11-10', dateTo: '2027-02-08' },
    ]);
    // Los pasos 2 y 3, en ese orden: la sincronización con el bloqueo, y las marcas y el mensaje en una
    // transacción.
    expect(calls).toEqual([
      'BEGIN',
      'COMMIT',
      'lock',
      'sync',
      'unlock',
      'BEGIN',
      'ari',
      'processed',
      'COMMIT',
    ]);
  });

  it('el bloqueo es el de las tareas de Channex', () => {
    expect(CHANNEX_LOCK).toBe('channex-sync');
  });

  it.each(['ADDED', 'REMOVED'] as const)(
    'con %s y sin previousCategoryRoom anota solo su categoría',
    async (action) => {
      const { service, record } = aService();

      await service.execute(notice({ action, previousCategoryRoom: null }));

      expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
        { categoryRoom: 'SUITE', dateFrom: '2026-11-10', dateTo: '2027-02-08' },
      ]);
    },
  );

  it('un previousCategoryRoom igual a la categoría no se anota dos veces', async () => {
    const { service, record } = aService();

    await service.execute(notice({ previousCategoryRoom: 'SUITE' }));

    expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
      { categoryRoom: 'SUITE', dateFrom: '2026-11-10', dateTo: '2027-02-08' },
    ]);
  });

  it('anota los días de CHANNEX_ARI_DAYS', async () => {
    const { service, record } = aService({ ariDays: 30 });

    await service.execute(notice({ previousCategoryRoom: null }));

    expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
      { categoryRoom: 'SUITE', dateFrom: '2026-11-10', dateTo: '2026-12-10' },
    ]);
  });

  it('registra el mensaje en processed_message, en la misma transacción que las marcas', async () => {
    const { service, recordMessage } = aService();

    await service.execute(notice());

    expect(recordMessage).toHaveBeenCalledExactlyOnceWith(
      {
        messageId: '0b6f2d14-8e3a-4c5b-b7d9-6a1e3f9c2d57',
        queue: QUEUE,
        sequenceNumber: 4,
      },
      TX,
    );
  });

  describe('paso 1: un messageId ya atendido', () => {
    it('se confirma sin sincronizar, sin bloqueo y sin marcas', async () => {
      const { service, record, recordMessage, sync, runExclusive } = aService({
        processed: [true],
      });

      expect(await service.execute(notice())).toBe('DUPLICATE');

      expect(runExclusive).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(recordMessage).not.toHaveBeenCalled();
    });

    it('si otra entrega lo atendió mientras se sincronizaba, tampoco deja marcas', async () => {
      const { service, record, recordMessage } = aService({
        processed: [false, true],
      });

      expect(await service.execute(notice())).toBe('DUPLICATE');

      expect(record).not.toHaveBeenCalled();
      expect(recordMessage).not.toHaveBeenCalled();
    });
  });

  describe('bloqueo ocupado (otra tarea de Channex corriendo)', () => {
    it('lanza ChannexLockBusyError, que la cola reintenta, sin sincronizar, sin marcas y sin registrar el mensaje', async () => {
      const { service, record, recordMessage, sync } = aService({
        lockBusy: true,
      });

      await expect(service.execute(notice())).rejects.toBeInstanceOf(
        ChannexLockBusyError,
      );

      expect(sync).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(recordMessage).not.toHaveBeenCalled();
    });
  });

  describe('NOT_SYNCED (el Módulo 1 o Channex no responden)', () => {
    it('anota las marcas y confirma el aviso igual', async () => {
      const { service, record, recordMessage } = aService({
        sync: { status: 'NOT_SYNCED', reason: 'CHANNEX_UNAVAILABLE' },
      });

      expect(await service.execute(notice())).toBe('APPLIED');

      expect(record).toHaveBeenCalledOnce();
      expect(recordMessage).toHaveBeenCalledOnce();
    });
  });

  describe('Channex sin configurar o sin verificar', () => {
    it('no sincroniza ni toma el bloqueo: solo anota las marcas, como E1', async () => {
      const { service, record, recordMessage, sync, runExclusive } = aService({
        ready: false,
      });

      expect(await service.execute(notice())).toBe('APPLIED');

      expect(runExclusive).not.toHaveBeenCalled();
      expect(sync).not.toHaveBeenCalled();
      expect(record).toHaveBeenCalledOnce();
      expect(recordMessage).toHaveBeenCalledOnce();
    });

    it('con la configuración inválida anota los 90 días por defecto', async () => {
      const { service, record } = aService({ ready: false, ariDays: null });

      await service.execute(notice({ previousCategoryRoom: null }));

      expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
        { categoryRoom: 'SUITE', dateFrom: '2026-11-10', dateTo: '2027-02-08' },
      ]);
    });
  });

  it('un error inesperado de la sincronización sale tal cual, sin marcas: la cola lo reintenta', async () => {
    const { service, record, sync } = aService();
    sync.mockRejectedValueOnce(new Error('la base de datos no responde'));

    await expect(service.execute(notice())).rejects.toThrow(
      'la base de datos no responde',
    );

    expect(record).not.toHaveBeenCalled();
  });
});
