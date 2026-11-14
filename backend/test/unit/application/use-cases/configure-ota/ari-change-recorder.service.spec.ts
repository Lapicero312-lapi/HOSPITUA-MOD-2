import { describe, expect, it, vi } from 'vitest';
import type {
  AriChange,
  AriPendingChangeRepository,
} from '../../../../../src/application/ports/out/ari-pending-change.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import { AriChangeRecorderService } from '../../../../../src/application/use-cases/configure-ota/ari-change-recorder.service.js';

/** La transacción del caso de uso que cambió la ocupación: el servicio solo la pasa al repositorio. */
const TX = { id: 'tx' } as unknown as Transaction;

/** El rango del ejemplo de A4 del plan de `configure-ota`: una noche, la del 10 de noviembre. */
const DOBLE_ONE_NIGHT: AriChange = {
  categoryRoom: 'DOBLE',
  dateFrom: '2026-11-10',
  dateTo: '2026-11-11',
};

function recorder() {
  const pendingChanges = {
    insert: vi.fn((_changes: AriChange[], _tx: Transaction) =>
      Promise.resolve(),
    ),
  };
  return {
    service: new AriChangeRecorderService(
      pendingChanges as unknown as AriPendingChangeRepository,
    ),
    pendingChanges,
  };
}

describe('AriChangeRecorder (plan de configure-ota, B2)', () => {
  it('deja las marcas en la transacción del cambio, tal como llegan', async () => {
    const { service, pendingChanges } = recorder();
    const changes = [
      DOBLE_ONE_NIGHT,
      { categoryRoom: 'SUITE', dateFrom: '2026-11-12', dateTo: '2026-11-15' },
    ];

    await service.record(TX, changes);

    expect(pendingChanges.insert).toHaveBeenCalledTimes(1);
    expect(pendingChanges.insert).toHaveBeenCalledWith(changes, TX);
  });

  it('no une las marcas iguales: las une el envío (regla 4)', async () => {
    const { service, pendingChanges } = recorder();

    await service.record(TX, [DOBLE_ONE_NIGHT, DOBLE_ONE_NIGHT]);

    expect(pendingChanges.insert.mock.calls[0][0]).toEqual([
      DOBLE_ONE_NIGHT,
      DOBLE_ONE_NIGHT,
    ]);
  });

  it('si el repositorio falla, el error sale: el caso de uso revierte su transacción', async () => {
    const { service, pendingChanges } = recorder();
    pendingChanges.insert.mockRejectedValueOnce(
      new Error('la base no responde'),
    );

    await expect(service.record(TX, [DOBLE_ONE_NIGHT])).rejects.toThrow(
      'la base no responde',
    );
  });
});
