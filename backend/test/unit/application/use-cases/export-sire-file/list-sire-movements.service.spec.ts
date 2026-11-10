import { describe, expect, it, vi } from 'vitest';
import { ListSireMovementsService } from '../../../../../src/application/use-cases/export-sire-file/list-sire-movements.service.js';
import type {
  SelectForeignMovements,
  SireMovement,
} from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';

const OCTOBER = { startDate: '2026-10-01', endDate: '2026-10-31' };
const NO_MOVEMENTS =
  'No hay movimientos migratorios que reportar en ese periodo.';

/** John Smith, del ejemplo del contrato B. */
const JOHN_ENTRY: SireMovement = {
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
  },
};

/** Su salida, tres días después. */
const JOHN_DEPARTURE: SireMovement = {
  ...JOHN_ENTRY,
  movementId: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
  movementType: 'DEPARTURE',
  movementDate: '2026-10-12',
};

/** `count` movimientos distintos, en el orden en que los entrega la selección. */
function movements(count: number): SireMovement[] {
  return Array.from({ length: count }, (_, index) => ({
    ...JOHN_ENTRY,
    movementId: `movimiento-${index + 1}`,
    guest: { ...JOHN_ENTRY.guest, documentNumber: `DOC${index + 1}` },
  }));
}

function serviceWith(selected: SireMovement[]) {
  const byPeriod = vi
    .fn<SelectForeignMovements['byPeriod']>()
    .mockResolvedValue(selected);
  return {
    service: new ListSireMovementsService({
      byPeriod,
      byMovementId: vi.fn(),
    }),
    byPeriod,
  };
}

/** Los `movementId` de una página. */
const idsOf = (items: { movementId: string }[]) =>
  items.map((item) => item.movementId);

describe('ListSireMovementsService (plan de export-sire-file, contrato B y D3)', () => {
  it('pide a la selección del archivo los movimientos del periodo', async () => {
    const { service, byPeriod } = serviceWith([JOHN_ENTRY]);

    await service.execute({ ...OCTOBER, page: 1 });

    expect(byPeriod).toHaveBeenCalledExactlyOnceWith(
      '2026-10-01',
      '2026-10-31',
    );
  });

  it('devuelve los elementos del ejemplo de B: el nombre completo tal como se guardó y sin la fecha de nacimiento ni los lugares', async () => {
    const { service } = serviceWith([JOHN_ENTRY, JOHN_DEPARTURE]);

    await expect(service.execute({ ...OCTOBER, page: 1 })).resolves.toEqual({
      items: [
        {
          movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
          reservationRef: 'RSV-3F9A1C7B',
          guest: {
            fullName: 'John Smith',
            documentType: 'PAS',
            documentNumber: 'X99',
            nationality: 'Estados Unidos',
          },
          movementType: 'ENTRY',
          movementDate: '2026-10-09',
        },
        {
          movementId: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
          reservationRef: 'RSV-3F9A1C7B',
          guest: {
            fullName: 'John Smith',
            documentType: 'PAS',
            documentNumber: 'X99',
            nationality: 'Estados Unidos',
          },
          movementType: 'DEPARTURE',
          movementDate: '2026-10-12',
        },
      ],
      page: 1,
      pageSize: 50,
      totalItems: 2,
      totalPages: 1,
      message: null,
    });
  });

  it('un periodo sin extranjeros no es un error: la página vacía con el mensaje (punto 3)', async () => {
    const { service } = serviceWith([]);

    await expect(service.execute({ ...OCTOBER, page: 3 })).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 0,
      message: NO_MOVEMENTS,
    });
  });

  it('pagina de 50 en 50 en el orden de la selección, con los totales del periodo', async () => {
    const all = movements(120);
    const { service } = serviceWith(all);

    const first = await service.execute({ ...OCTOBER, page: 1 });
    const second = await service.execute({ ...OCTOBER, page: 2 });
    const last = await service.execute({ ...OCTOBER, page: 3 });

    expect(idsOf(first.items)).toEqual(idsOf(all.slice(0, 50)));
    expect(idsOf(second.items)).toEqual(idsOf(all.slice(50, 100)));
    expect(idsOf(last.items)).toEqual(idsOf(all.slice(100)));
    for (const [result, page] of [
      [first, 1],
      [second, 2],
      [last, 3],
    ] as const) {
      expect(result).toMatchObject({
        page,
        pageSize: 50,
        totalItems: 120,
        totalPages: 3,
        message: null,
      });
    }
  });

  it.each([
    [50, 1],
    [51, 2],
    [100, 2],
    [101, 3],
  ])('con %i movimientos hay %i páginas', async (count, totalPages) => {
    const { service } = serviceWith(movements(count));

    await expect(
      service.execute({ ...OCTOBER, page: 1 }),
    ).resolves.toMatchObject({ totalItems: count, totalPages });
  });

  it('una página que no existe se ajusta a la última válida', async () => {
    const all = movements(51);
    const { service } = serviceWith(all);

    const result = await service.execute({ ...OCTOBER, page: 9 });

    expect(result).toMatchObject({ page: 2, totalPages: 2, totalItems: 51 });
    expect(idsOf(result.items)).toEqual(['movimiento-51']);
  });
});
