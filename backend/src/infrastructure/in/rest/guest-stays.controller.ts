import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  readGuestStayFilters,
  readGuestStayKey,
} from '../../../application/use-cases/process-guest-data/guest-stay-filters.validator.js';
import {
  GET_GUEST_STAY_DETAIL,
  type GetGuestStayDetail,
  type GuestStayDetail,
} from '../../../application/use-cases/process-guest-data/ports/in/get-guest-stay-detail.port.js';
import {
  LIST_GUEST_STAYS,
  type GuestStayPage,
  type ListGuestStays,
} from '../../../application/use-cases/process-guest-data/ports/in/list-guest-stays.port.js';

/**
 * La vista de huéspedes alojados de la Recepcionista (plan de `process-guest-data`, C1 y C2). Solo
 * lectura. Sin prefijo propio: el detalle cuelga de la reserva (`/api/reservations/…/guests/…`).
 */
@Controller()
export class GuestStaysController {
  constructor(
    @Inject(LIST_GUEST_STAYS)
    private readonly listGuestStays: ListGuestStays,
    @Inject(GET_GUEST_STAY_DETAIL)
    private readonly getGuestStayDetail: GetGuestStayDetail,
  ) {}

  /**
   * C1, `GET /api/guest-stays`: revisa los filtros antes de consultar (D3) y devuelve la página. Con un
   * filtro inválido, el filtro global responde 400 con el código del validador.
   */
  @Get('guest-stays')
  async list(
    @Query('nationality') nationality: unknown,
    @Query('presence') presence: unknown,
    @Query('dateFrom') dateFrom: unknown,
    @Query('dateTo') dateTo: unknown,
    @Query('search') search: unknown,
    @Query('page') page: unknown,
  ): Promise<GuestStayPage> {
    const filters = readGuestStayFilters({
      nationality,
      presence,
      dateFrom,
      dateTo,
      search,
      page,
    });
    return this.listGuestStays.execute(filters);
  }

  /**
   * C2 con el `documentNumber` vacío (`…/guests` o `…/guests/`): sin esta ruta, el filtro global la
   * respondería como una ruta que no existe (`400 REQUEST_NOT_PROCESSED`). Pasa por la misma revisión que
   * `detail`: `INVALID_RESERVATION_CODE` o `INVALID_DOCUMENT_NUMBER`.
   */
  @Get('reservations/:reservationRef/guests')
  async detailWithoutDocument(
    @Param('reservationRef') reservationRef: string,
  ): Promise<GuestStayDetail> {
    return this.detail(reservationRef, '');
  }

  /**
   * C2, `GET /api/reservations/{reservationRef}/guests/{documentNumber}`: revisa los dos antes de
   * consultar. Con un formato inválido o un huésped que no está, el filtro global responde 400.
   */
  @Get('reservations/:reservationRef/guests/:documentNumber')
  async detail(
    @Param('reservationRef') reservationRef: string,
    @Param('documentNumber') documentNumber: string,
  ): Promise<GuestStayDetail> {
    const key = readGuestStayKey(reservationRef, documentNumber);
    return this.getGuestStayDetail.execute(
      key.reservationRef,
      key.documentNumber,
    );
  }
}
