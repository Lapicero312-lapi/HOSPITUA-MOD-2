import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type {
  GuestStayQuery,
  GuestStayRow,
} from '../../../../../src/application/ports/out/guest-stay.query.js';
import type { GuestStayFilters } from '../../../../../src/application/use-cases/process-guest-data/guest-stay-filters.validator.js';
import { ListGuestStaysService } from '../../../../../src/application/use-cases/process-guest-data/list-guest-stays.service.js';

/** Sin filtros, página 1 (los valores por defecto de C1). */
const DEFAULTS: GuestStayFilters = {
  nationality: 'ALL',
  presence: 'ALL',
  dateRange: null,
  search: null,
  page: 1,
};

/** John Smith del ejemplo de C1, todavía en el hotel. */
const JOHN: GuestStayRow = {
  reservationRef: 'RSV-3F9A1C7B',
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  nationality: 'Estados Unidos',
  entryDate: '2026-10-09',
  exitDate: null,
};

const CLOCK: Clock = {
  today: () => '2026-10-15',
  now: () => new Date('2026-10-15T15:00:00Z'),
};

function serviceWith(total: number, rows: GuestStayRow[] = []) {
  const count = vi.fn<GuestStayQuery['count']>().mockResolvedValue(total);
  const findPage = vi.fn<GuestStayQuery['findPage']>().mockResolvedValue(rows);
  return {
    service: new ListGuestStaysService(
      { count, findPage, findDetail: vi.fn() },
      CLOCK,
    ),
    count,
    findPage,
  };
}

describe('ListGuestStaysService (plan de process-guest-data, C1 y D3)', () => {
  it('el ejemplo de C1: John en el hotel, extranjero, en la página 1 de 1', async () => {
    const { service } = serviceWith(1, [JOHN]);

    await expect(service.execute(DEFAULTS)).resolves.toEqual({
      items: [
        {
          reservationRef: 'RSV-3F9A1C7B',
          guest: {
            firstName: 'John',
            lastName: 'Smith',
            documentType: 'PAS',
            documentNumber: 'X99',
            nationality: 'Estados Unidos',
            isForeign: true,
          },
          entryDate: '2026-10-09',
          exitDate: null,
          inHotel: true,
        },
      ],
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
      message: null,
    });
  });

  it('pasa los filtros y el día operativo del reloj a la consulta, igual al contar y al traer la página', async () => {
    const filters: GuestStayFilters = {
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateRange: { dateFrom: '2026-10-01', dateTo: '2026-10-31' },
      search: { kind: 'NAME', text: 'smith' },
      page: 1,
    };
    const { service, count, findPage } = serviceWith(1, [JOHN]);

    await service.execute(filters);

    const criteria = {
      nationality: 'FOREIGN',
      presence: 'IN_HOTEL',
      dateRange: { dateFrom: '2026-10-01', dateTo: '2026-10-31' },
      search: { kind: 'NAME', text: 'smith' },
      today: '2026-10-15',
    };
    expect(count).toHaveBeenCalledExactlyOnceWith(criteria);
    expect(findPage).toHaveBeenCalledExactlyOnceWith(criteria, 0, 10);
  });

  it('con salida no está en el hotel; sin entrada tampoco', async () => {
    const { service } = serviceWith(2, [
      { ...JOHN, exitDate: '2026-10-12' },
      { ...JOHN, entryDate: null, exitDate: '2026-10-12' },
    ]);

    const { items } = await service.execute(DEFAULTS);

    expect(items.map(({ inHotel }) => inHotel)).toEqual([false, false]);
  });

  it.each([
    ['Colombia', false],
    ['', false],
    ['Venezuela', true],
  ])(
    'la marca de extranjero con la nacionalidad %j es %s (punto 8)',
    async (nationality, foreign) => {
      const { service } = serviceWith(1, [{ ...JOHN, nationality }]);

      const { items } = await service.execute(DEFAULTS);

      expect(items[0]?.guest.isForeign).toBe(foreign);
    },
  );

  it('la página 2 empieza en la fila 10', async () => {
    const { service, findPage } = serviceWith(25, [JOHN]);

    const page = await service.execute({ ...DEFAULTS, page: 2 });

    expect(findPage).toHaveBeenCalledWith(expect.anything(), 10, 10);
    expect(page).toMatchObject({ page: 2, totalItems: 25, totalPages: 3 });
  });

  it('una página que no existe se ajusta a la última válida', async () => {
    const { service, findPage } = serviceWith(25, [JOHN]);

    const page = await service.execute({ ...DEFAULTS, page: 9 });

    expect(findPage).toHaveBeenCalledWith(expect.anything(), 20, 10);
    expect(page).toMatchObject({ page: 3, totalPages: 3 });
  });

  it('con exactamente 10 filas hay una sola página', async () => {
    const { service } = serviceWith(10, [JOHN]);

    await expect(
      service.execute({ ...DEFAULTS, page: 2 }),
    ).resolves.toMatchObject({ page: 1, totalPages: 1 });
  });

  it('sin resultados (escenario 7): lista vacía, el mensaje del spec y sin pedir la página', async () => {
    const { service, findPage } = serviceWith(0);

    await expect(service.execute({ ...DEFAULTS, page: 4 })).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
      message: 'No hay huéspedes que coincidan con los filtros.',
    });
    expect(findPage).not.toHaveBeenCalled();
  });
});
