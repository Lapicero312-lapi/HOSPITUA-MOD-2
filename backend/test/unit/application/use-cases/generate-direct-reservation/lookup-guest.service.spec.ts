import { describe, expect, it, vi } from 'vitest';
import type { GuestRepository } from '../../../../../src/application/ports/out/guest.repository.js';
import { LookupGuestService } from '../../../../../src/application/use-cases/generate-direct-reservation/lookup-guest.service.js';
import type { Guest } from '../../../../../src/domain/guest/guest.js';
import { aGuest } from '../../../../support/builders.js';

function serviceWith(found: Guest | null) {
  const findLatestByDocument = vi
    .fn<GuestRepository['findLatestByDocument']>()
    .mockResolvedValue(found);
  return {
    service: new LookupGuestService({ findLatestByDocument }),
    findLatestByDocument,
  };
}

describe('LookupGuestService', () => {
  it('busca con el documento ya revisado y devuelve el titular que encuentra', async () => {
    const guest = aGuest({ documentNumber: '123' });
    const { service, findLatestByDocument } = serviceWith(guest);

    await expect(service.execute(' CC ', ' 123 ')).resolves.toBe(guest);
    expect(findLatestByDocument).toHaveBeenCalledExactlyOnceWith('CC', '123');
  });

  it('sin reservas con ese documento devuelve null, sin error (escenario 11)', async () => {
    const { service } = serviceWith(null);

    await expect(service.execute('CC', '999')).resolves.toBeNull();
  });

  it('con un documento no válido responde el error sin consultar la base de datos', async () => {
    const { service, findLatestByDocument } = serviceWith(null);

    await expect(service.execute('DNI', '123')).rejects.toMatchObject({
      errorCode: 'INVALID_DOCUMENT_TYPE',
    });
    expect(findLatestByDocument).not.toHaveBeenCalled();
  });
});
