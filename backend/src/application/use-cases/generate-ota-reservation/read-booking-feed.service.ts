import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BookingRevision } from '../../integration/booking-revision.js';
import {
  BOOKING_FEED_PAGE_SIZE,
  CHANNEX_PORT,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
  type ChannexPort,
} from '../../ports/out/channex.port.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import { BOOKING_OTA_NAME } from '../configure-ota/ports/in/ensure-channex-setup.port.js';
import {
  MANAGE_OTA,
  type ManageOta,
} from '../register-ota-information-commission/ports/in/manage-ota.port.js';
import {
  OTA_CONNECTION_TRACKER,
  type OtaConnectionTracker,
} from '../register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import type {
  BookingFeedRead,
  ReadBookingFeed,
} from './ports/in/read-booking-feed.port.js';

/**
 * Lee todas las páginas del feed antes de procesar nada, para que un `ack` no corra las páginas (plan, A1),
 * y lleva la conexión de la agencia Booking.com (plan, punto 7; regla 8).
 */
@Injectable()
export class ReadBookingFeedService implements ReadBookingFeed {
  private readonly logger = new Logger(ReadBookingFeedService.name);

  constructor(
    @Inject(CHANNEX_PORT)
    private readonly channex: ChannexPort,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(OTA_CONNECTION_TRACKER)
    private readonly connection: OtaConnectionTracker,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async read(): Promise<BookingFeedRead> {
    const at = this.clock.now();
    let revisions: BookingRevision[];
    try {
      revisions = await this.allPages();
    } catch (error) {
      if (error instanceof ChannexUnauthorizedError) {
        this.logger.warn(
          `${error.message} La agencia pasa a DISCONNECTED y no se procesa nada.`,
        );
        await this.connection.markDisconnected(await this.bookingOtaId(at), at);
        return { status: 'NOT_READ' };
      }
      if (
        error instanceof ChannexRateLimitedError ||
        error instanceof ChannexUnavailableError ||
        error instanceof ChannexRejectedError
      ) {
        // Un 4xx que no es 401, 403 ni 429 se trata como un 5xx (punto 7). La pausa ante un 429 la lleva
        // el adaptador.
        this.logger.warn(
          `${error.message} No se procesa nada; se lee de nuevo en la siguiente lectura.`,
        );
        return { status: 'NOT_READ' };
      }
      throw error;
    }
    await this.connection.markSynced(await this.bookingOtaId(at), at);
    return { status: 'READ', revisions };
  }

  /** De la página 1 hasta cubrir el `meta.total` de la última respuesta (punto 7). */
  private async allPages(): Promise<BookingRevision[]> {
    const revisions: BookingRevision[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.channex.fetchBookingFeed(page);
      revisions.push(...result.revisions);
      // Se guía por `meta.total` y no por lo que llega: el adaptador descarta las revisiones ilegibles.
      if (page * BOOKING_FEED_PAGE_SIZE >= result.total) {
        return revisions;
      }
    }
  }

  /**
   * La agencia Booking.com: `configure-ota` ya la registró al iniciar, así que `register` la devuelve sin
   * cambiarla (plan de `register-ota-information-commission`, B2).
   */
  private async bookingOtaId(at: Date): Promise<string> {
    return (await this.otas.register({ name: BOOKING_OTA_NAME }, at)).id;
  }
}
