import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Ota } from '../../../domain/ota/ota.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  DuplicateOtaError,
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import { OTA_NOT_FOUND } from './error-codes.js';
import type { ManageOta, OtaRegistration } from './ports/in/manage-ota.port.js';

/**
 * Registra la agencia sin porcentaje y guarda el que se calcula con su primera reserva (plan, B2). La
 * agencia nunca se borra, y su porcentaje no se recalcula (FR-002).
 */
@Injectable()
export class ManageOtaService implements ManageOta {
  constructor(
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
  ) {}

  async register(data: OtaRegistration, at: Date): Promise<Ota> {
    const existing = await this.otas.findByName(data.name);
    if (existing !== null) {
      return existing;
    }
    // Lanza INVALID_OTA_DATA si el nombre está vacío.
    const ota = Ota.restore({
      id: randomUUID(),
      name: data.name,
      commissionPercentage: null,
      connectionStatus: 'CONNECTED',
      linkedAt: at,
      lastSyncAt: at,
    });
    try {
      return await this.otas.insert(ota);
    } catch (error) {
      // Otro arranque la registró a la vez: se devuelve esa, sin crear otra.
      if (error instanceof DuplicateOtaError) {
        const registered = await this.otas.findByName(data.name);
        if (registered !== null) {
          return registered;
        }
      }
      throw error;
    }
  }

  async setCommissionPercentage(
    tx: Transaction,
    otaId: string,
    commissionPercentage: string,
  ): Promise<void> {
    const ota = await this.otas.findById(otaId, tx);
    if (ota === null) {
      throw new BusinessError(OTA_NOT_FOUND.code, OTA_NOT_FOUND.message);
    }
    if (ota.commissionPercentage !== null) {
      return;
    }
    // Lanza INVALID_OTA_DATA si el porcentaje está fuera de 0 a 100.
    await this.otas.update(
      Ota.restore({ ...ota.snapshot(), commissionPercentage }),
      tx,
    );
  }
}
