import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  OTA_REPOSITORY,
  type OtaOverview,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import { OTA_NOT_FOUND } from './error-codes.js';
import type { GetOta } from './ports/in/get-ota.port.js';

/** UUID en su forma estándar `8-4-4-4-12` (hexadecimal), de cualquier versión: la forma del `id` de la `Ota`. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una agencia (plan, A3 y D3), con el conteo de sus reservas activas. */
@Injectable()
export class GetOtaService implements GetOta {
  constructor(
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
  ) {}

  async execute(otaId: string): Promise<OtaOverview> {
    // Un `otaId` que no es un UUID no es el de ninguna agencia, y la base lo rechazaría: no se consulta.
    const ota = UUID_FORMAT.test(otaId)
      ? await this.otas.findOverviewById(otaId)
      : null;
    if (ota === null) {
      throw new BusinessError(OTA_NOT_FOUND.code, OTA_NOT_FOUND.message);
    }
    return ota;
  }
}
