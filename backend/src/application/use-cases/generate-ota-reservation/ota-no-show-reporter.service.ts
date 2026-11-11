import { Inject, Injectable } from '@nestjs/common';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import {
  OTA_BOOKING_REVISION_REPOSITORY,
  type OtaBookingRevisionRepository,
} from '../../ports/out/ota-booking-revision.repository.js';
import {
  OTA_NO_SHOW_REPORT_REPOSITORY,
  type OtaNoShowReportRepository,
} from '../../ports/out/ota-no-show-report.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import type { OtaNoShowReporter } from './ports/in/ota-no-show-reporter.port.js';

/**
 * Deja pendiente el reporte del no-show de una reserva de Booking en la transacción del cierre del día
 * (plan, regla 9 y punto 8). El envío lo hace `PublishPendingNoShows` en `ChannexSyncJob`.
 */
@Injectable()
export class OtaNoShowReporterService implements OtaNoShowReporter {
  constructor(
    @Inject(OTA_BOOKING_REVISION_REPOSITORY)
    private readonly revisions: OtaBookingRevisionRepository,
    @Inject(OTA_NO_SHOW_REPORT_REPOSITORY)
    private readonly reports: OtaNoShowReportRepository,
  ) {}

  async record(tx: Transaction, reservation: Reservation): Promise<void> {
    if (reservation.source !== 'OTA') {
      throw new Error(
        `La reserva ${reservation.reservationRef} no es de Booking: no tiene no-show que reportar.`,
      );
    }
    const bookingId = await this.revisions.findBookingIdOf(reservation.id, tx);
    if (bookingId === null) {
      throw new Error(
        `La reserva ${reservation.reservationRef} de Booking no tiene ninguna revisión: no se puede dejar pendiente el reporte de su no-show.`,
      );
    }
    await this.reports.insertPending(tx, reservation.id, bookingId);
  }
}
