import { describe, expect, it, vi } from 'vitest';
import type {
  OtaCommissionFilters,
  OtaCommissionRow,
  OtaCommissionRows,
  ReservationQueryPort,
} from '../../../../../src/application/ports/out/reservation-query.port.js';
import { ListOtaCommissionsService } from '../../../../../src/application/use-cases/register-ota-information-commission/list-ota-commissions.service.js';
import { Money } from '../../../../../src/domain/shared/money.js';

const FILTERS: OtaCommissionFilters = {
  dateFrom: '2026-10-01',
  dateTo: '2026-10-31',
  commissionStatus: null,
  reservationStatus: null,
  otaId: null,
};

const aRow = (reservationRef: string): OtaCommissionRow => ({
  reservationRef,
  otaId: '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90',
  otaName: 'Booking.com',
  externalConfirmationCode: '4417829013',
  status: 'COMPLETED',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  grossAmount: Money.of('400', 'USD'),
  commissionPercentage: '15.00',
  commissionAmount: Money.of('60', 'USD'),
  commissionStatus: 'CALCULATED',
});

/** El puerto simulado: cuántas hay en total y qué trae cada página. */
function serviceWith(
  totalItems: number,
  pages: Record<number, OtaCommissionRow[]>,
) {
  const listOtaCommissions = vi.fn(
    (
      _filters: OtaCommissionFilters,
      page: number,
    ): Promise<OtaCommissionRows> =>
      Promise.resolve({ totalItems, items: pages[page] ?? [] }),
  );
  const service = new ListOtaCommissionsService({
    listOtaCommissions,
  } as unknown as ReservationQueryPort);
  return { service, listOtaCommissions };
}

describe('ListOtaCommissions (A1 de register-ota-information-commission, punto C1; T011)', () => {
  it('la página pedida, de a 100, con el total y las páginas; pasa los filtros tal cual', async () => {
    const { service, listOtaCommissions } = serviceWith(150, {
      2: [aRow('RSV-0000000A')],
    });

    const result = await service.execute(FILTERS, 2);

    expect(listOtaCommissions).toHaveBeenCalledExactlyOnceWith(FILTERS, 2);
    expect(result).toEqual({
      items: [aRow('RSV-0000000A')],
      page: 2,
      pageSize: 100,
      totalItems: 150,
      totalPages: 2,
    });
  });

  it('una página que pasa de la última devuelve la última válida, y page la informa', async () => {
    const { service, listOtaCommissions } = serviceWith(150, {
      2: [aRow('RSV-0000000B')],
    });

    const result = await service.execute(FILTERS, 9);

    expect(listOtaCommissions).toHaveBeenNthCalledWith(2, FILTERS, 2);
    expect(result).toMatchObject({ page: 2, totalPages: 2 });
    expect(result.items).toEqual([aRow('RSV-0000000B')]);
  });

  it('sin resultados: items vacío en la página 1 y 0 páginas, sin otra consulta', async () => {
    const { service, listOtaCommissions } = serviceWith(0, {});

    expect(await service.execute(FILTERS, 4)).toEqual({
      items: [],
      page: 1,
      pageSize: 100,
      totalItems: 0,
      totalPages: 0,
    });
    expect(listOtaCommissions).toHaveBeenCalledTimes(1);
  });

  it.each([
    [100, 1],
    [101, 2],
    [200, 2],
    [201, 3],
  ])('%i comisiones son %i páginas', async (totalItems, totalPages) => {
    const { service } = serviceWith(totalItems, { 1: [aRow('RSV-0000000C')] });

    expect((await service.execute(FILTERS, 1)).totalPages).toBe(totalPages);
  });
});
