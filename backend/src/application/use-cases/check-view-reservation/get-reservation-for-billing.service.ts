import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_RESERVATION_CODE,
  RESERVATION_NOT_FOUND,
} from '../../../domain/shared/error-codes.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import type {
  GetReservationForBilling,
  ReservationForBilling,
} from './ports/in/get-reservation-for-billing.port.js';

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base), como en C3. */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

/**
 * La consulta del Módulo 3 (plan, C4 y "Consulta del Módulo 3", T032): lee la reserva como
 * `GetReservationDetail` (C3), con la misma validación del formato (T017), y entrega solo el canal, las
 * cotizaciones y, en `OTA`, la agencia, su código y el porcentaje congelado.
 */
@Injectable()
export class GetReservationForBillingService implements GetReservationForBilling {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
  ) {}

  async execute(reservationRef: string): Promise<ReservationForBilling> {
    if (!RESERVATION_REF_FORMAT.test(reservationRef)) {
      throw new BusinessError(
        INVALID_RESERVATION_CODE.code,
        INVALID_RESERVATION_CODE.message,
      );
    }
    const reservation = await this.reservations.findByRef(reservationRef);
    if (reservation === null) {
      throw new BusinessError(
        RESERVATION_NOT_FOUND.code,
        RESERVATION_NOT_FOUND.message,
      );
    }
    const { ota } = reservation;
    return {
      reservationRef: reservation.reservationRef,
      channel: reservation.source,
      // Una reserva de OTA no tiene cotización: la lista va vacía (C4).
      quoteIds: reservation.rooms.flatMap((room) =>
        room.rate === null ? [] : [room.rate.quoteId],
      ),
      ota:
        ota === null
          ? null
          : {
              otaId: ota.otaId,
              confirmationCode: ota.externalConfirmationCode,
              commissionPercentage: ota.commissionPercentage,
            },
    };
  }
}
