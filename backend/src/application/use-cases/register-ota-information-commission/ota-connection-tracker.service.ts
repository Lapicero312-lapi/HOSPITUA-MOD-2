import { Inject, Injectable } from '@nestjs/common';
import { canChangeConnectionStatus } from '../../../domain/ota/connection-status.js';
import type { Ota } from '../../../domain/ota/ota.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import { OTA_NOT_FOUND } from './error-codes.js';
import type { OtaConnectionTracker } from './ports/in/ota-connection-tracker.port.js';

/**
 * Lleva el `connectionStatus` y el `lastSyncAt` de la agencia, según las respuestas de Channex (plan, B3).
 * Solo guarda esas dos columnas: no pisa el porcentaje que guarda `setCommissionPercentage`.
 */
@Injectable()
export class OtaConnectionTrackerService implements OtaConnectionTracker {
  constructor(
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
  ) {}

  async markSynced(otaId: string, at: Date): Promise<void> {
    const ota = await this.find(otaId);
    const connectionStatus = canChangeConnectionStatus(
      ota.connectionStatus,
      'CONNECTED',
    )
      ? 'CONNECTED'
      : ota.connectionStatus;
    await this.otas.updateConnection(otaId, connectionStatus, at);
  }

  // No usa el `at` del puerto: `lastSyncAt` es la última lectura que terminó bien, y esta no terminó bien.
  async markDisconnected(otaId: string): Promise<void> {
    const ota = await this.find(otaId);
    if (!canChangeConnectionStatus(ota.connectionStatus, 'DISCONNECTED')) {
      return;
    }
    await this.otas.updateConnection(otaId, 'DISCONNECTED');
  }

  private async find(otaId: string): Promise<Ota> {
    const ota = await this.otas.findById(otaId);
    if (ota === null) {
      throw new BusinessError(OTA_NOT_FOUND.code, OTA_NOT_FOUND.message);
    }
    return ota;
  }
}
