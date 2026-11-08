import { Inject, Injectable } from '@nestjs/common';
import { isForeign } from '../../../domain/migration/is-foreign.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  GUEST_STAY_QUERY,
  type GuestStayQuery,
} from '../../ports/out/guest-stay.query.js';
import { GUEST_NOT_FOUND } from './error-codes.js';
import type {
  GetGuestStayDetail,
  GuestStayDetail,
} from './ports/in/get-guest-stay-detail.port.js';

/**
 * `GetGuestStayDetail` (plan, C2): el huésped en la reserva, con todos sus datos, el enlace a la reserva
 * y sus movimientos. Sin movimientos no existe para la vista (FR-016), igual que en el listado.
 */
@Injectable()
export class GetGuestStayDetailService implements GetGuestStayDetail {
  constructor(
    @Inject(GUEST_STAY_QUERY)
    private readonly query: GuestStayQuery,
  ) {}

  async execute(
    reservationRef: string,
    documentNumber: string,
  ): Promise<GuestStayDetail> {
    const row = await this.query.findDetail(reservationRef, documentNumber);
    if (row === null || row.movements.length === 0) {
      throw new BusinessError(GUEST_NOT_FOUND.code, GUEST_NOT_FOUND.message);
    }
    return {
      reservationRef: row.reservationRef,
      reservationLink: `/api/reservations/${row.reservationRef}`,
      guest: {
        documentType: row.documentType,
        documentNumber: row.documentNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        birthDate: row.birthDate,
        nationality: row.nationality,
        isForeign: isForeign(row.nationality),
        originPlace: emptyAsNull(row.originPlace),
        destinationPlace: emptyAsNull(row.destinationPlace),
      },
      movements: row.movements,
    };
  }
}

/** "Lo vacío … viaja `null`" (C2): sin dato o con un texto vacío. */
function emptyAsNull(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}
