import { describe, expect, it, vi } from 'vitest';
import type { ChannexSetupState } from '../../../../../src/application/ports/out/channex-setup-state.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { ProcessedMessageRepository } from '../../../../../src/application/ports/out/processed-message.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import { HandleMaintenanceNoticeService } from '../../../../../src/application/use-cases/configure-ota/handle-maintenance-notice.service.js';
import type { AriChangeRecorder } from '../../../../../src/application/use-cases/configure-ota/ports/in/ari-change-recorder.port.js';
import type { MaintenanceNotice } from '../../../../../src/application/use-cases/configure-ota/ports/in/handle-maintenance-notice.port.js';

const TX = { tx: 'la del aviso' } as unknown as Transaction;
const TODAY = '2026-11-10';
const QUEUE = 'm2.habitacion.mantenimiento.queue';

/** El ejemplo de E1 del plan: la 201 de DOBLE pasa del 12-13 al 14-15 de noviembre. */
const notice = (
  changes: Partial<MaintenanceNotice> = {},
): MaintenanceNotice => ({
  messageId: '7c1e9a52-3b0d-4f7e-9a61-2d8c5b4e1f03',
  sequenceNumber: 12,
  queue: QUEUE,
  action: 'UPDATED',
  roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  categoryRoom: 'DOBLE',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  previous: { startDate: '2026-11-12', endDate: '2026-11-13' },
  ...changes,
});

function aService(
  options: { processed?: boolean; ariDays?: number | null } = {},
) {
  const calls: string[] = [];
  const run = vi.fn((work: (tx: Transaction) => Promise<unknown>) => {
    calls.push('BEGIN');
    return work(TX).then((result) => {
      calls.push('COMMIT');
      return result;
    });
  });
  const isProcessed = vi.fn(() => Promise.resolve(options.processed ?? false));
  const recordMessage = vi.fn(() => {
    calls.push('processed');
    return Promise.resolve();
  });
  const record = vi.fn<AriChangeRecorder['record']>(() => {
    calls.push('ari');
    return Promise.resolve();
  });
  const ariDays = options.ariDays === undefined ? 90 : options.ariDays;
  const channex = {
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
  const service = new HandleMaintenanceNoticeService(
    { run } as unknown as TransactionRunner,
    {
      isProcessed,
      record: recordMessage,
    } as unknown as ProcessedMessageRepository,
    { record },
    channex,
    clock,
  );
  return { service, calls, record, recordMessage, isProcessed };
}

describe('HandleMaintenanceNotice (E1 de configure-ota; T012b)', () => {
  it('el ejemplo de E1 (UPDATED): anota la categoría en las fechas nuevas y en las anteriores, con la salida al día siguiente', async () => {
    const { service, record, calls } = aService();

    expect(await service.execute(notice())).toBe('APPLIED');

    expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
      { categoryRoom: 'DOBLE', dateFrom: '2026-11-14', dateTo: '2026-11-16' },
      { categoryRoom: 'DOBLE', dateFrom: '2026-11-12', dateTo: '2026-11-14' },
    ]);
    expect(calls).toEqual(['BEGIN', 'ari', 'processed', 'COMMIT']);
  });

  it.each(['SCHEDULED', 'CANCELLED'] as const)(
    'con %s anota solo las fechas del mantenimiento',
    async (action) => {
      const { service, record } = aService();

      await service.execute(notice({ action }));

      expect(record).toHaveBeenCalledExactlyOnceWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2026-11-14', dateTo: '2026-11-16' },
      ]);
    },
  );

  it('registra el mensaje en processed_message, en la misma transacción', async () => {
    const { service, recordMessage } = aService();

    await service.execute(notice());

    expect(recordMessage).toHaveBeenCalledExactlyOnceWith(
      {
        messageId: '7c1e9a52-3b0d-4f7e-9a61-2d8c5b4e1f03',
        queue: QUEUE,
        sequenceNumber: 12,
      },
      TX,
    );
  });

  it('un messageId ya atendido se confirma sin efectos', async () => {
    const { service, record, recordMessage } = aService({ processed: true });

    expect(await service.execute(notice())).toBe('DUPLICATE');

    expect(record).not.toHaveBeenCalled();
    expect(recordMessage).not.toHaveBeenCalled();
  });

  describe('recortadas a hoy y a los próximos días de CHANNEX_ARI_DAYS', () => {
    it('un mantenimiento que empezó ayer se anota desde hoy', async () => {
      const { service, record } = aService();

      await service.execute(
        notice({
          action: 'SCHEDULED',
          startDate: '2026-11-08',
          endDate: '2026-11-11',
        }),
      );

      expect(record).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: TODAY, dateTo: '2026-11-12' },
      ]);
    });

    it('uno que ya terminó no deja marca, pero el mensaje sí queda registrado', async () => {
      const { service, record, recordMessage } = aService();

      expect(
        await service.execute(
          notice({
            action: 'CANCELLED',
            startDate: '2026-11-01',
            endDate: '2026-11-09',
          }),
        ),
      ).toBe('APPLIED');

      expect(record).not.toHaveBeenCalled();
      expect(recordMessage).toHaveBeenCalledTimes(1);
    });

    it('el último día que se anota es hoy más CHANNEX_ARI_DAYS menos uno', async () => {
      const { service, record } = aService({ ariDays: 5 });

      await service.execute(
        notice({
          action: 'SCHEDULED',
          startDate: '2026-11-12',
          endDate: '2026-11-30',
        }),
      );

      expect(record).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2026-11-12', dateTo: '2026-11-15' },
      ]);
    });

    it('uno más allá de ese plazo no deja marca', async () => {
      const { service, record } = aService({ ariDays: 2 });

      await service.execute(
        notice({
          action: 'SCHEDULED',
          startDate: '2026-11-20',
          endDate: '2026-11-21',
        }),
      );

      expect(record).not.toHaveBeenCalled();
    });

    it('sin configuración de Channex válida usa 90 días', async () => {
      const { service, record } = aService({ ariDays: null });

      await service.execute(
        notice({
          action: 'SCHEDULED',
          startDate: '2027-02-07',
          endDate: '2027-02-10',
        }),
      );

      // Hoy más 90 es el 2027-02-08: se anota solo la noche del 7.
      expect(record).toHaveBeenCalledWith(TX, [
        { categoryRoom: 'DOBLE', dateFrom: '2027-02-07', dateTo: '2027-02-08' },
      ]);
    });
  });
});
