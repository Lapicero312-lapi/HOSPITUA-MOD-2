import { describe, expect, it, vi } from 'vitest';
import type {
  ReservationListFilters,
  ReservationListItem,
  ReservationListPage,
  ReservationQueryPort,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import { ListReservationsService } from '../../../../../src/application/use-cases/check-view-reservation/list-reservations.service.js';
import { aDirectReservation } from '../../../../support/builders.js';

const NO_FILTERS: ReservationListFilters = {
  status: null,
  source: null,
  otaId: null,
  inConflict: false,
  stayRange: null,
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

    const result = await service.execute(NO_FILTERS, 1);

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
    const filters: ReservationListFilters = {
      ...NO_FILTERS,
      status: 'PENDING',
      stayRange: { dateFrom: '2026-10-02', dateTo: '2026-10-06' },
      order: 'asc',
    };

    await service.execute(filters, 3);

    expect(listReservations).toHaveBeenCalledWith(filters, 3);
  });

  it('escenario 7: con 25 reservas, la página 3 trae las 5 últimas de 3 páginas', async () => {
    const page3 = ['RSV-00000020', 'RSV-00000021'].map(anItem);
    const { service } = serviceWith(25, { 3: page3 });

    const result = await service.execute(NO_FILTERS, 3);

    expect(result).toMatchObject({ page: 3, totalItems: 25, totalPages: 3 });
    expect(refsOf(result)).toEqual(['RSV-00000020', 'RSV-00000021']);
  });

  describe('T011: página que no existe y respuesta vacía', () => {
    it('una página que pasa de la última devuelve la última válida, y page la informa', async () => {
      const last = ['RSV-00000020'].map(anItem);
      const { service, listReservations } = serviceWith(25, { 3: last });

      const result = await service.execute(NO_FILTERS, 9);

      expect(listReservations).toHaveBeenNthCalledWith(2, NO_FILTERS, 3);
      expect(result).toMatchObject({ page: 3, totalPages: 3, message: null });
      expect(refsOf(result)).toEqual(['RSV-00000020']);
    });

    it('escenario 8: sin resultados, items vacío, total y páginas en 0 y el mensaje de FR-010', async () => {
      const { service, listReservations } = serviceWith(0, {});

      const result = await service.execute(NO_FILTERS, 4);

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

      expect((await service.execute(NO_FILTERS, 1)).totalPages).toBe(
        totalPages,
      );
    });
  });
});
