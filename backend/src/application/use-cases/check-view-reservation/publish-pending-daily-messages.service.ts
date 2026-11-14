import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  EXCLUSIVE_RUNNER,
  type ExclusiveRunner,
} from '../../ports/out/exclusive-runner.js';
import {
  DAILY_LIST_PUBLISHER,
  type DailyListPublisher,
} from '../../ports/out/daily-list-publisher.js';
import {
  DAILY_MESSAGE_REPOSITORY,
  type DailyMessageRepository,
  type UnpublishedDailyMessage,
} from '../../ports/out/daily-message.repository.js';
import type { PublishPendingDailyMessages } from './ports/in/publish-pending-daily-messages.port.js';

/** Cuántos mensajes lee de una vez (paso 1). */
export const UNPUBLISHED_BATCH = 100;

/** En el décimo intento fallido el mensaje pasa a `FAILED` (punto 4 de "Publicación en orden"). */
export const MAX_ATTEMPTS = 10;

/** La espera después de cada intento fallido: 5 s, 15 s, 45 s, 2 min y, del quinto en adelante, 5 min. */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

/** El bloqueo asesor de la publicación: el mismo para la tarea de 10 s y la inmediata (T029). */
export const PUBLISH_LOCK = 'daily-list-publish';

/** Lo que pasó con un mensaje. */
type Outcome = 'PUBLISHED' | 'STOPPED';

/**
 * `PublishPendingDailyMessages` (plan, "Publicar los mensajes", T026). No abre una transacción: cada
 * mensaje se marca por separado, apenas RabbitMQ lo confirma. Se detiene en el primero que no puede salir,
 * para que un mensaje nunca salga antes que uno anterior.
 */
@Injectable()
export class PublishPendingDailyMessagesService implements PublishPendingDailyMessages {
  private readonly logger = new Logger(PublishPendingDailyMessagesService.name);

  constructor(
    @Inject(DAILY_MESSAGE_REPOSITORY)
    private readonly messages: DailyMessageRepository,
    @Inject(DAILY_LIST_PUBLISHER)
    private readonly publisher: DailyListPublisher,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(EXCLUSIVE_RUNNER)
    private readonly lock: ExclusiveRunner,
  ) {}

  /** Una ejecución pidió publicar mientras otra tenía el bloqueo: la que lo tiene vuelve a leer. */
  private missed = false;

  /**
   * Con el bloqueo `daily-list-publish` (T029). Si otra ejecución lo tiene, no publica y lo anota; la que
   * lo tiene, al soltarlo, vuelve a leer una vez, para que ningún mensaje confirmado mientras tanto espere a
   * la tarea de 10 s (NFR-005).
   */
  async execute(): Promise<number> {
    let published = 0;
    const ran = await this.lock.runExclusive(PUBLISH_LOCK, async () => {
      published = await this.publishInOrder();
    });
    if (!ran) {
      this.missed = true;
      return 0;
    }
    if (this.missed) {
      this.missed = false;
      await this.lock.runExclusive(PUBLISH_LOCK, async () => {
        published += await this.publishInOrder();
      });
    }
    return published;
  }

  /** Los pasos 1 a 4 de `execute` en el plan. */
  private async publishInOrder(): Promise<number> {
    let published = 0;
    for (;;) {
      // Paso 1.
      const batch = await this.messages.findUnpublished(UNPUBLISHED_BATCH);
      for (const message of batch) {
        // Paso 2: uno FAILED bloquea a los siguientes; uno que todavía no llega a su hora, también.
        if (!this.canGo(message)) {
          return published;
        }
        // Paso 3.
        if ((await this.publish(message)) === 'STOPPED') {
          return published;
        }
        published += 1;
      }
      // Paso 4: si salieron los 100, puede haber más.
      if (batch.length < UNPUBLISHED_BATCH) {
        return published;
      }
    }
  }

  private canGo(message: UnpublishedDailyMessage): boolean {
    return (
      message.publishStatus !== 'FAILED' &&
      (message.nextAttemptAt === null ||
        message.nextAttemptAt.getTime() <= this.clock.now().getTime())
    );
  }

  /** Lo publica y deja su resultado; un fallo suma un intento y detiene la publicación. */
  private async publish(message: UnpublishedDailyMessage): Promise<Outcome> {
    try {
      await this.publisher.publish({
        messageId: message.messageId,
        kind: message.kind,
        payload: message.payload,
      });
    } catch (error) {
      await this.recordFailure(message, error);
      return 'STOPPED';
    }
    await this.messages.markPublished(message.messageId, this.clock.now());
    return 'PUBLISHED';
  }

  /**
   * Con menos de 10 intentos sigue `PENDING` hasta su próxima hora; en el décimo pasa a `FAILED` con una
   * alerta. Los logs no llevan el `payload`: tiene datos personales.
   */
  private async recordFailure(
    message: UnpublishedDailyMessage,
    error: unknown,
  ): Promise<void> {
    const attempts = message.attempts + 1;
    const reason = error instanceof Error ? error.message : String(error);
    if (attempts >= MAX_ATTEMPTS) {
      await this.messages.recordFailure(
        message.messageId,
        attempts,
        'FAILED',
        null,
      );
      this.logger.error(
        `El mensaje ${message.messageId} de la lista del ${message.operationalDate} (secuencia ${message.sequenceNumber}) no se pudo publicar en ${attempts} intentos y pasa a FAILED: los siguientes esperan detrás hasta que se reencole. Último error: ${reason}`,
      );
      return;
    }
    const delay =
      RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1];
    const nextAttemptAt = new Date(this.clock.now().getTime() + delay);
    await this.messages.recordFailure(
      message.messageId,
      attempts,
      'PENDING',
      nextAttemptAt,
    );
    this.logger.warn(
      `El mensaje ${message.messageId} (secuencia ${message.sequenceNumber}) no se pudo publicar (intento ${attempts}); se reintenta desde ${nextAttemptAt.toISOString()}: ${reason}`,
    );
  }
}
