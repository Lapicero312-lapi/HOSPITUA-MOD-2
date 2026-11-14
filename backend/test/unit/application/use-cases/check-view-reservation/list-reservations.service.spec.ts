import { describe, expect, it, vi } from 'vitest';
import type {
  ReservationListFilters,
  ReservationListItem,
  ReservationListPage,
  ReservationQueryPort,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import { ListReservationsService } from '../../../../../src/application/use-cases/check-view-reservation/list-reservations.service.js';
import type { ListReservationFilters } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/list-reservations.port.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { aDirectReservation } from '../../../../support/builders.js';

const NO_FILTERS: ListReservationFilters = {
  status: null,
  source: null,
  otaId: null,
  inConflict: false,
  stayRange: null,
  arrivalDate: null,
  order: 'desc',
};
const MESSAGE = 'No se encontraron reservas con los filtros aplicados.';

const anItem = (reservationRef: string): ReservationListItem => ({
  reservation: aDirectReservation({ reservationRef }),
  otaName: null,
  hasForeignMovement: false,
});

/** El puerto simulado: cuántas reservas hay en total y qué devuelve cada página que se pide. */
function serviceWith(
  totalItems: number,
  pages: Record<number, ReservationListItem[]>,
) {
  const listReservations = vi.fn(
    (
      _filters: ReservationListFilters,
      page: number,
    ): Promise<ReservationListPage> =>
      Promise.resolve({ totalItems, items: pages[page] ?? [] }),
  );
  const service = new ListReservationsService({
    listReservations,
  } as unknown as ReservationQueryPort);
  return { service, listReservations };
}

const refsOf = (result: { items: { reservationRef: string }[] }) =>
  result.items.map((item) => item.reservationRef);

describe('ListReservations (plan de check-view-reservation, C1, T009 y T011)', () => {
  it('escenario 1: con 45 reservas, la página 1 de 10, 45 en total y 5 páginas, sin mensaje', async () => {
    const page1 = Array.from({ length: 10 }, (_, i) =>
      anItem(`RSV-0000000${i}`),
    );
    const { service, listReservations } = serviceWith(45, { 1: page1 });

    const result = await service.execute(NO_FILTERS, 1, null);

    expect(result).toMatchObject({
      page: 1,
      pageSize: 10,
      totalItems: 45,
      totalPages: 5,
      message: null,
    });
    expect(result.items).toHaveLength(10);
    expect(listReservations).toHaveBeenCalledTimes(1);
  });

  it('pasa los filtros y la página tal como llegan', async () => {
    const { service, listReservations } = serviceWith(0, {});
    const filters: ListReservationFilters = {
      ...NO_FILTERS,
      status: 'PENDING',
      stayRange: { dateFrom: '2026-10-02', dateTo: '2026-10-06' },
      order: 'asc',
    };

    await service.execute(filters, 3, null);

    expect(listReservations).toHaveBeenCalledWith(
      { ...filters, search: null },
      3,
    );
  });

  it('escenario 7: con 25 reservas, la página 3 trae las 5 últimas de 3 páginas', async () => {
    const page3 = ['RSV-00000020', 'RSV-00000021'].map(anItem);
    const { service } = serviceWith(25, { 3: page3 });

    const result = await service.execute(NO_FILTERS, 3, null);

    expect(result).toMatchObject({ page: 3, totalItems: 25, totalPages: 3 });
    expect(refsOf(result)).toEqual(['RSV-00000020', 'RSV-00000021']);
  });

  describe('T011: página que no existe y respuesta vacía', () => {
    it('una página que pasa de la última devuelve la última válida, y page la informa', async () => {
      const last = ['RSV-00000020'].map(anItem);
      const { service, listReservations } = serviceWith(25, { 3: last });

      const result = await service.execute(NO_FILTERS, 9, null);

      expect(listReservations).toHaveBeenNthCalledWith(
        2,
        { ...NO_FILTERS, search: null },
        3,
      );
      expect(result).toMatchObject({ page: 3, totalPages: 3, message: null });
      expect(refsOf(result)).toEqual(['RSV-00000020']);
    });

    it('escenario 8: sin resultados, items vacío, total y páginas en 0 y el mensaje de FR-010', async () => {
      const { service, listReservations } = serviceWith(0, {});

      const result = await service.execute(NO_FILTERS, 4, null);

      expect(result).toEqual({
        items: [],
        page: 1,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0,
        message: MESSAGE,
      });
      expect(listReservations).toHaveBeenCalledTimes(1);
    });

    it.each([
      [10, 1],
      [11, 2],
      [20, 2],
      [21, 3],
    ])('%i reservas son %i páginas', async (totalItems, totalPages) => {
      const { service } = serviceWith(totalItems, {
        1: [anItem('RSV-0000000A')],
      });

      expect((await service.execute(NO_FILTERS, 1, null)).totalPages).toBe(
        totalPages,
      );
    });
  });

  describe('la búsqueda (T015, T020 y T021)', () => {
    /** El puerto simulado: cuántas reservas trae cada criterio, según su `kind` (o sin búsqueda). */
    function searchingWith(totals: Partial<Record<string, number>>) {
      const listReservations = vi.fn(
        (
          filters: ReservationListFilters,
          _page: number,
        ): Promise<ReservationListPage> => {
          const totalItems = totals[filters.search?.kind ?? 'NONE'] ?? 0;
          return Promise.resolve({
            totalItems,
            items: totalItems > 0 ? [anItem('RSV-3F9A1C7B')] : [],
          });
        },
      );
      const service = new ListReservationsService({
        listReservations,
      } as unknown as ReservationQueryPort);
      return { service, listReservations };
    }

    const filters: ListReservationFilters = {
      ...NO_FILTERS,
      status: 'ACTIVE',
      source: 'DIRECT',
    };

    it('un código que coincide: esa es la respuesta, con el texto sin los espacios de los extremos', async () => {
      const { service, listReservations } = searchingWith({ CODE: 1 });

      const result = await service.execute(filters, 1, '  rsv-3f9a1c7b ');

      expect(result.totalItems).toBe(1);
      expect(listReservations).toHaveBeenCalledExactlyOnceWith(
        { ...filters, search: { kind: 'CODE', code: 'rsv-3f9a1c7b' } },
        1,
      );
    });

    it('una referencia RSV- sin coincidencia: RESERVATION_NOT_FOUND, sin buscar por nombre', async () => {
      const { service, listReservations } = searchingWith({});

      const error = await service
        .execute(filters, 1, 'RSV-ABCDEF12')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BusinessError);
      expect((error as BusinessError).errorCode).toBe('RESERVATION_NOT_FOUND');
      expect(listReservations).toHaveBeenCalledTimes(1);
    });

    it('con dígitos y sin coincidencia de código: el documento exacto, combinado con los filtros, en la misma página', async () => {
      const { service, listReservations } = searchingWith({ DOCUMENT: 1 });

      const result = await service.execute(filters, 2, '1144093552');

      expect(result.totalItems).toBe(1);
      expect(listReservations).toHaveBeenNthCalledWith(
        2,
        {
          ...filters,
          search: { kind: 'DOCUMENT', documentNumber: '1144093552' },
        },
        2,
      );
    });

    it('sin dígitos y sin coincidencia de código: el nombre parcial, combinado con los filtros', async () => {
      const { service, listReservations } = searchingWith({ NAME: 1 });

      await service.execute(filters, 1, 'osp');

      expect(listReservations).toHaveBeenNthCalledWith(
        2,
        { ...filters, search: { kind: 'NAME', name: 'osp' } },
        1,
      );
    });

    it('sin coincidencias en el fallback: la respuesta vacía con su mensaje', async () => {
      const { service } = searchingWith({});

      expect(await service.execute(filters, 1, 'Zuluaga')).toMatchObject({
        items: [],
        totalItems: 0,
        message: MESSAGE,
      });
    });

    it('T021: un nombre de menos de 3 caracteres responde NAME_SEARCH_TOO_SHORT sin consultar la base', async () => {
      const { service, listReservations } = searchingWith({});

      const error = await service
        .execute(filters, 1, 'An')
        .catch((caught: unknown) => caught);

      expect((error as BusinessError).errorCode).toBe('NAME_SEARCH_TOO_SHORT');
      expect(listReservations).not.toHaveBeenCalled();
    });

    it('la búsqueda por documento conserva el ajuste a la última página válida (T011)', async () => {
      const { service, listReservations } = searchingWith({ DOCUMENT: 1 });

      const result = await service.execute(filters, 5, '1144093552');

      expect(result.page).toBe(1);
      expect(listReservations).toHaveBeenLastCalledWith(
        {
          ...filters,
          search: { kind: 'DOCUMENT', documentNumber: '1144093552' },
        },
        1,
      );
    });
  });
});
