import { Inject, Injectable } from '@nestjs/common';
import {
  ARI_PENDING_CHANGE_REPOSITORY,
  type AriChange,
  type AriPendingChangeRepository,
} from '../../ports/out/ari-pending-change.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import type { AriChangeRecorder } from './ports/in/ari-change-recorder.port.js';

/**
 * Deja las marcas de disponibilidad pendiente en `ari_pending_change` (plan de `configure-ota`, B2), en la
 * transacción del caso de uso que cambió la ocupación. Las marcas iguales no se unen aquí: las une
 * `PublishPendingAvailability` al enviar (regla 4).
 */
@Injectable()
export class AriChangeRecorderService implements AriChangeRecorder {
  constructor(
    @Inject(ARI_PENDING_CHANGE_REPOSITORY)
    private readonly pendingChanges: AriPendingChangeRepository,
  ) {}

  async record(tx: Transaction, changes: AriChange[]): Promise<void> {
    await this.pendingChanges.insert(changes, tx);
  }
}
