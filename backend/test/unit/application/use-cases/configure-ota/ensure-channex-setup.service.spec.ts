import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import { EnsureChannexSetupService } from '../../../../../src/application/use-cases/configure-ota/ensure-channex-setup.service.js';
import type {
  ChannexVerification,
  VerifyChannexProperty,
} from '../../../../../src/application/use-cases/configure-ota/ports/in/verify-channex-property.port.js';
import type { ManageOta } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/manage-ota.port.js';
import { anOta } from '../../../../support/builders.js';

const NOW = new Date('2026-10-30T14:00:00.000Z');

function serviceVerifying(result: ChannexVerification | Error) {
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
  return {
    service: new EnsureChannexSetupService(verification, otas, clock),
    otas,
  };
}

describe('EnsureChannexSetup.ensure', () => {
  it('con la propiedad verificada registra la agencia Booking.com, ahora', async () => {
    const { service, otas } = serviceVerifying('READY');

    await expect(service.ensure()).resolves.toBe('READY');
    expect(otas.register).toHaveBeenCalledWith({ name: 'Booking.com' }, NOW);
  });

  it.each(['DISABLED', 'RETRY'] as const)(
    'con %s no registra la agencia',
    async (result) => {
      const { service, otas } = serviceVerifying(result);

      await expect(service.ensure()).resolves.toBe(result);
      expect(otas.register).not.toHaveBeenCalled();
    },
  );

  it('si registrar la agencia falla, el error sale para que quien llama lo reintente', async () => {
    const { service, otas } = serviceVerifying('READY');
    otas.register.mockRejectedValueOnce(new Error('la base no responde'));

    await expect(service.ensure()).rejects.toThrow('la base no responde');
  });
});
