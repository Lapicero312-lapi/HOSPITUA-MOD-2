import { describe, expect, it, vi } from 'vitest';
import type {
  MigratoryMovementRepository,
  MovementWithGuest,
} from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import { SelectForeignMovementsService } from '../../../../../src/application/use-cases/process-guest-data/select-foreign-movements.service.js';

/** John Smith, extranjero, del ejemplo de B2 y del mensaje de Check-In del plan de `update-reservation`. */
function aMovement(
  changes: Partial<Omit<MovementWithGuest, 'guest'>> = {},
  guest: Partial<MovementWithGuest['guest']> = {},
): MovementWithGuest {
  return {
    movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
    reservationRef: 'RSV-3F9A1C7B',
    movementType: 'ENTRY',
    movementDate: '2026-10-09',
    guest: {
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: 'X99',
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
      ...guest,
    },
    ...changes,
  };
}

function serviceWith(stored: MovementWithGuest[]) {
  const findWithGuestByPeriod = vi
    .fn<MigratoryMovementRepository['findWithGuestByPeriod']>()
    .mockResolvedValue(stored);
  const findWithGuestById = vi
    .fn<MigratoryMovementRepository['findWithGuestById']>()
    .mockImplementation((id) =>
      Promise.resolve(
        stored.find(({ movementId }) => movementId === id) ?? null,
      ),
    );
  const service = new SelectForeignMovementsService({
    insertMissing: vi.fn(),
    findWithGuestByPeriod,
    findWithGuestById,
  });
  return { service, findWithGuestByPeriod, findWithGuestById };
}

describe('SelectForeignMovementsService (plan de process-guest-data, B2)', () => {
  describe('byPeriod', () => {
    it('pide el periodo tal cual y deja solo los de extranjeros', async () => {
      const foreign = aMovement();
      const colombian = aMovement(
        { movementId: 'c0000000-0000-4000-8000-000000000001' },
        { documentType: 'CC', documentNumber: '123', nationality: 'Colombia' },
      );
      const { service, findWithGuestByPeriod } = serviceWith([
        colombian,
        foreign,
      ]);

      await expect(
        service.byPeriod('2026-10-01', '2026-10-31'),
      ).resolves.toEqual([foreign]);
      expect(findWithGuestByPeriod).toHaveBeenCalledExactlyOnceWith(
        '2026-10-01',
        '2026-10-31',
      );
    });

    it('una nacionalidad vacía no es extranjera (punto 8)', async () => {
      const { service } = serviceWith([aMovement({}, { nationality: '' })]);

      await expect(
        service.byPeriod('2026-10-01', '2026-10-31'),
      ).resolves.toEqual([]);
    });

    it('"COLOMBIA" en mayúsculas sí cuenta como extranjera: la comparación es exacta (punto 8)', async () => {
      const upper = aMovement({}, { nationality: 'COLOMBIA' });
      const { service } = serviceWith([upper]);

      await expect(
        service.byPeriod('2026-10-01', '2026-10-31'),
      ).resolves.toEqual([upper]);
    });

    it('sin extranjeros devuelve una lista vacía', async () => {
      const { service } = serviceWith([
        aMovement({}, { nationality: 'Colombia' }),
      ]);

      await expect(
        service.byPeriod('2026-10-01', '2026-10-31'),
      ).resolves.toEqual([]);
    });

    it('ordena por fecha, reserva, documento y tipo, con ENTRY antes que DEPARTURE', async () => {
      const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
      // En el orden esperado. La 2 va antes que las demás del 2026-10-10 por su reserva, aunque su
      // documento (ZZ9) sea el último; la 4 (ENTRY) va antes que la 5 (DEPARTURE) del mismo huésped.
      const ordered = [
        aMovement({ movementId: id(1), movementDate: '2026-10-09' }),
        aMovement(
          {
            movementId: id(2),
            movementDate: '2026-10-10',
            reservationRef: 'RSV-00000001',
          },
          { documentNumber: 'ZZ9' },
        ),
        aMovement(
          { movementId: id(3), movementDate: '2026-10-10' },
          { documentNumber: 'A1' },
        ),
        aMovement(
          { movementId: id(4), movementDate: '2026-10-10' },
          { documentNumber: 'B2' },
        ),
        aMovement(
          {
            movementId: id(5),
            movementDate: '2026-10-10',
            movementType: 'DEPARTURE',
          },
          { documentNumber: 'B2' },
        ),
        aMovement({
          movementId: id(6),
          movementDate: '2026-10-10',
          reservationRef: 'RSV-8D02E5A4',
        }),
      ];
      const { service } = serviceWith([...ordered].reverse());

      const result = await service.byPeriod('2026-10-01', '2026-10-31');

      expect(result.map(({ movementId }) => movementId)).toEqual(
        ordered.map(({ movementId }) => movementId),
      );
    });

    it('entrega los datos sin modificarlos ni completarlos, aunque vengan vacíos (SC-002)', async () => {
      const stored = aMovement(
        {},
        { firstName: ' john ', originPlace: null, destinationPlace: '' },
      );
      const { service } = serviceWith([stored]);

      const [movement] = await service.byPeriod('2026-10-01', '2026-10-31');

      expect(movement).toEqual(stored);
      expect(movement).not.toBe(stored);
      // Una copia: cambiar lo entregado no cambia lo leído.
      expect(movement.guest).not.toBe(stored.guest);
    });
  });

  describe('byMovementId', () => {
    it('el movimiento de un extranjero', async () => {
      const foreign = aMovement();
      const { service } = serviceWith([foreign]);

      await expect(service.byMovementId(foreign.movementId)).resolves.toEqual(
        foreign,
      );
    });

    it('el de un colombiano es null', async () => {
      const colombian = aMovement({}, { nationality: 'Colombia' });
      const { service } = serviceWith([colombian]);

      await expect(
        service.byMovementId(colombian.movementId),
      ).resolves.toBeNull();
    });

    it('uno que no existe es null', async () => {
      const { service } = serviceWith([]);

      await expect(
        service.byMovementId('9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a'),
      ).resolves.toBeNull();
    });

    it.each([
      '',
      '123',
      'no-es-un-uuid',
      '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5',
    ])(
      'con un id que no es UUID (%j) es null sin consultar la base',
      async (movementId) => {
        const { service, findWithGuestById } = serviceWith([aMovement()]);

        await expect(service.byMovementId(movementId)).resolves.toBeNull();
        expect(findWithGuestById).not.toHaveBeenCalled();
      },
    );
  });
});
