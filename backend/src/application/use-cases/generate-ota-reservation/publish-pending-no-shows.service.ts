import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHANNEX_PORT,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
  type ChannexPort,
} from '../../ports/out/channex.port.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  OTA_NO_SHOW_REPORT_REPOSITORY,
  type OtaNoShowReportRepository,
  type PendingNoShow,
} from '../../ports/out/ota-no-show-report.repository.js';
import type {
  NoShowPublication,
  PublishPendingNoShows,
} from './ports/in/publish-pending-no-shows.port.js';

/** Los rechazos de A3 que no se reintentan: la reserva no existe en Channex o no admite el no-show. */
const FINAL_REJECTIONS = [404, 422];

/** Qué hacer después de intentar un reporte. */
type Outcome = 'REPORTED' | 'REJECTED' | 'RETRY' | 'STOP';

/**
 * Envía a Channex los no-shows pendientes (plan, A3 y punto 8; FR-011). Un fallo de Channex nunca revierte
 * el `NO_SHOW`: el reporte sigue `PENDING` y se reintenta en el ciclo siguiente de `ChannexSyncJob`.
 */
@Injectable()
export class PublishPendingNoShowsService implements PublishPendingNoShows {
  private readonly logger = new Logger(PublishPendingNoShowsService.name);

  constructor(
    @Inject(OTA_NO_SHOW_REPORT_REPOSITORY)
    private readonly reports: OtaNoShowReportRepository,
    @Inject(CHANNEX_PORT)
    private readonly channex: ChannexPort,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async publish(): Promise<NoShowPublication> {
    const pending = await this.reports.findPending();
    const publication: NoShowPublication = {
      reported: 0,
      rejected: 0,
      pending: 0,
    };
    for (const [index, report] of pending.entries()) {
      const outcome = await this.send(report);
      if (outcome === 'REPORTED') {
        publication.reported += 1;
      } else if (outcome === 'REJECTED') {
        publication.rejected += 1;
      } else if (outcome === 'RETRY') {
        publication.pending += 1;
      } else {
        // Las demás fallarían igual (y con un 429 hay que respetar la pausa): quedan para el ciclo siguiente.
        publication.pending += pending.length - index;
        break;
      }
    }
    if (pending.length > 0) {
      this.logger.log(
        `No-shows a Channex: ${publication.reported} reportados, ${publication.rejected} rechazados y ${publication.pending} pendientes.`,
      );
    }
    return publication;
  }

  /** Un reporte: lo envía y deja su resultado. */
  private async send(report: PendingNoShow): Promise<Outcome> {
    try {
      await this.channex.reportNoShow(report.bookingId);
    } catch (error) {
      if (
        error instanceof ChannexRejectedError &&
        FINAL_REJECTIONS.includes(error.status)
      ) {
        await this.reports.markRejected(report.reservationId);
        this.logger.warn(
          `Channex rechazó el no-show de la reserva ${report.reservationId}: ${error.message} No se vuelve a intentar.`,
        );
        return 'REJECTED';
      }
      if (error instanceof ChannexRejectedError) {
        await this.reports.countAttempt(report.reservationId);
        this.logger.warn(
          `Channex no aceptó el no-show de la reserva ${report.reservationId}: ${error.message} Se reintenta en el ciclo siguiente.`,
        );
        return 'RETRY';
      }
      if (
        error instanceof ChannexUnauthorizedError ||
        error instanceof ChannexRateLimitedError ||
        error instanceof ChannexUnavailableError
      ) {
        await this.reports.countAttempt(report.reservationId);
        this.logger.warn(
          `No se pudo reportar el no-show de la reserva ${report.reservationId}: ${error.message} Los pendientes se reintentan en el ciclo siguiente.`,
        );
        return 'STOP';
      }
      throw error;
    }
    await this.reports.markReported(report.reservationId, this.clock.now());
    return 'REPORTED';
  }
}
