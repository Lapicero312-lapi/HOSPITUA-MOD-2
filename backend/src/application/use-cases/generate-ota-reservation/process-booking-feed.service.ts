import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHANNEX_PORT,
  type ChannexPort,
} from '../../ports/out/channex.port.js';
import {
  OTA_BOOKING_REVISION_REPOSITORY,
  type OtaBookingRevisionRepository,
} from '../../ports/out/ota-booking-revision.repository.js';
import type { ProcessBookingFeed } from './ports/in/process-booking-feed.port.js';
import {
  PROCESS_BOOKING_REVISION,
  type ProcessBookingRevision,
} from './ports/in/process-booking-revision.port.js';
import {
  READ_BOOKING_FEED,
  type ReadBookingFeed,
} from './ports/in/read-booking-feed.port.js';

/**
 * `ProcessBookingFeed` (plan de `generate-ota-reservation`, punto 9; T007). El `ack` va siempre después del
 * COMMIT de la revisión: si falla, la fila queda con `acked_at` vacío y se repite en el ciclo siguiente
 * (regla 2). Si una revisión no se guarda, las siguientes de la misma reserva esperan (regla 3).
 */
@Injectable()
export class ProcessBookingFeedService implements ProcessBookingFeed {
  private readonly logger = new Logger(ProcessBookingFeedService.name);

  constructor(
    @Inject(OTA_BOOKING_REVISION_REPOSITORY)
    private readonly revisions: OtaBookingRevisionRepository,
    @Inject(CHANNEX_PORT)
    private readonly channex: ChannexPort,
    @Inject(READ_BOOKING_FEED)
    private readonly feed: ReadBookingFeed,
    @Inject(PROCESS_BOOKING_REVISION)
    private readonly revision: ProcessBookingRevision,
  ) {}

  async run(): Promise<boolean> {
    // Primero, los `ack` que quedaron pendientes en un ciclo anterior.
    for (const pending of await this.revisions.findPendingAck()) {
      await this.acknowledge(pending.revisionId);
    }

    const read = await this.feed.read();
    if (read.status !== 'READ') {
      return false;
    }
    // Las reservas con una revisión que no se guardó en esta lectura: sus siguientes esperan.
    const waiting = new Set<string>();
    for (const revision of read.revisions) {
      if (waiting.has(revision.bookingId)) {
        continue;
      }
      let outcome;
      try {
        outcome = await this.revision.process(revision);
      } catch (error) {
        // Sin datos personales: el id de la revisión y el tipo del error.
        this.logger.error(
          `La revisión ${revision.id} falló por un error inesperado (${error instanceof Error ? error.name : typeof error}); se lee de nuevo en el ciclo siguiente.`,
        );
        waiting.add(revision.bookingId);
        continue;
      }
      if (outcome.kind === 'RETRY') {
        this.logger.warn(
          `${outcome.reason}. Se lee de nuevo en el ciclo siguiente, sin ack.`,
        );
        waiting.add(revision.bookingId);
        continue;
      }
      await this.acknowledge(revision.id);
    }
    return true;
  }

  /** A2: el `ack` a Channex y, si responde, `acked_at`. Si falla, se repite en el ciclo siguiente. */
  private async acknowledge(revisionId: string): Promise<void> {
    try {
      await this.channex.ackBookingRevision(revisionId);
    } catch (error) {
      this.logger.warn(
        `El ack de la revisión ${revisionId} no salió (${error instanceof Error ? error.message : typeof error}); se repite en el ciclo siguiente.`,
      );
      return;
    }
    await this.revisions.markAcked(revisionId);
  }
}
