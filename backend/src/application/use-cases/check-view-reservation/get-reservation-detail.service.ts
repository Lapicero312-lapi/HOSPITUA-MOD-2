import { Inject, Injectable } from '@nestjs/common';
import type { Cancellation } from '../../../domain/cancellation/cancellation.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_RESERVATION_CODE,
  RESERVATION_NOT_FOUND,
} from '../../../domain/shared/error-codes.js';
import {
  CANCELLATION_REPOSITORY,
  type CancellationRepository,
} from '../../ports/out/cancellation.repository.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import type {
  GetReservationDetail,
  ReservationDetail,
} from './ports/in/get-reservation-detail.port.js';

/** `RSV-` y 8 caracteres hexadecimales en mayúscula (plan base). */
const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;

const MS_PER_DAY = 86_400_000;

/**
 * `GetReservationDetail` (plan de `check-view-reservation`, "`GetReservationDetail`"; T016 y T017):
 * 1. revisa el formato de `reservationRef` antes de tocar la base;
 * 2. busca la reserva completa (`RESERVATION_NOT_FOUND` si no existe);
 * 3. en una `OTA`, lee el nombre de su agencia;
 * 4. en una `CANCELLED`, lee su `Cancellation`.
 */
@Injectable()
export class GetReservationDetailService implements GetReservationDetail {
  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
    @Inject(CANCELLATION_REPOSITORY)
    private readonly cancellations: CancellationRepository,
  ) {}

  async execute(reservationRef: string): Promise<ReservationDetail> {
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
    return {
      reservation,
      nights: nightsOf(reservation),
      otaName: await this.otaNameOf(reservation),
      cancellation: await this.cancellationOf(reservation),
    };
  }

  private async otaNameOf(reservation: Reservation): Promise<string | null> {
    if (reservation.ota === null) {
      return null;
    }
    const ota = await this.otas.findById(reservation.ota.otaId);
    if (ota === null) {
      // La clave foránea de reservation.ota_id lo impide: es un error del programa o de los datos.
      throw new Error(
        `La agencia ${reservation.ota.otaId} de la reserva ${reservation.reservationRef} no existe.`,
      );
    }
    return ota.name;
  }

  private cancellationOf(
    reservation: Reservation,
  ): Promise<Cancellation | null> {
    if (reservation.status !== 'CANCELLED') {
      return Promise.resolve(null);
    }
    return this.cancellations.findByReservationId(reservation.id);
  }
}

/** Las noches de la estadía: los días entre la llegada y la salida (`AAAA-MM-DD`, sin hora). */
function nightsOf(reservation: Reservation): number {
  return (
    (Date.parse(reservation.endDate) - Date.parse(reservation.startDate)) /
    MS_PER_DAY
  );
}
