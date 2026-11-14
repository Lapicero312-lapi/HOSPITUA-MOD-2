import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import { EnsureChannexSetupService } from '../../../../../src/application/use-cases/configure-ota/ensure-channex-setup.service.js';
import type {
  ChannexVerification,
  VerifyChannexProperty,
} from '../../../../../src/application/use-cases/configure-ota/ports/in/verify-channex-property.port.js';
import type {
  RoomTypeSync,
  SyncRoomTypes,
} from '../../../../../src/application/use-cases/configure-ota/ports/in/sync-room-types.port.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import { anOta } from '../../../../support/builders.js';

const NOW = new Date('2026-10-30T14:00:00.000Z');

function serviceVerifying(
  result: ChannexVerification | Error,
  synced: RoomTypeSync = { status: 'SYNCED', created: [] },
) {
  const verification = {
    verify: vi.fn(() =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result),
    ),
  } as unknown as VerifyChannexProperty;
  const otas = {
    register: vi.fn(() =>
      Promise.resolve(anOta({ commissionPercentage: null })),
    ),
  } as unknown as ManageOta & { register: ReturnType<typeof vi.fn> };
  const clock = { now: () => NOW, today: () => '2026-10-30' } as Clock;
  const roomTypes = {
    sync: vi.fn(() => Promise.resolve(synced)),
  } as unknown as SyncRoomTypes & { sync: ReturnType<typeof vi.fn> };
  return {
    service: new EnsureChannexSetupService(
      verification,
      otas,
      clock,
      roomTypes,
    ),
    otas,
    roomTypes,
  };
}

describe('EnsureChannexSetup.ensure', () => {
  it('con la propiedad verificada registra la agencia Booking.com, ahora', async () => {
    const { service, otas } = serviceVerifying('READY');

    await expect(service.ensure()).resolves.toBe('READY');
    expect(otas.register).toHaveBeenCalledWith({ name: 'Booking.com' }, NOW);
  });

  it.each(['DISABLED', 'RETRY'] as const)(
    'con %s no registra la agencia ni sincroniza los tipos',
    async (result) => {
      const { service, otas, roomTypes } = serviceVerifying(result);

      await expect(service.ensure()).resolves.toBe(result);
      expect(otas.register).not.toHaveBeenCalled();
      expect(roomTypes.sync).not.toHaveBeenCalled();
    },
  );

  it('paso 3: con la agencia registrada, sincroniza los tipos de habitación (T007)', async () => {
    const { service, otas, roomTypes } = serviceVerifying('READY');

    await service.ensure();

    expect(roomTypes.sync).toHaveBeenCalledTimes(1);
    expect(otas.register.mock.invocationCallOrder[0]).toBeLessThan(
      roomTypes.sync.mock.invocationCallOrder[0],
    );
  });

  it('una sincronización que no se completa no cambia el resultado: sigue READY', async () => {
    const { service } = serviceVerifying('READY', {
      status: 'NOT_SYNCED',
      reason: 'CHANNEX_UNAVAILABLE',
    });

    await expect(service.ensure()).resolves.toBe('READY');
  });

  it('un error inesperado de la sincronización (la base) se registra y sigue READY', async () => {
    const { service, roomTypes } = serviceVerifying('READY');
    roomTypes.sync.mockRejectedValueOnce(new Error('la base no responde'));
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.ensure()).resolves.toBe('READY');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('La sincronización de tipos de habitación falló'),
      expect.stringContaining('la base no responde'),
    );
    error.mockRestore();
  });

  it('si registrar la agencia falla, el error sale para que quien llama lo reintente, sin sincronizar', async () => {
    const { service, otas, roomTypes } = serviceVerifying('READY');
    otas.register.mockRejectedValueOnce(new Error('la base no responde'));

    await expect(service.ensure()).rejects.toThrow('la base no responde');
    expect(roomTypes.sync).not.toHaveBeenCalled();
  });
});
