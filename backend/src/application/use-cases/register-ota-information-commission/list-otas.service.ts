import { Inject, Injectable } from '@nestjs/common';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../ports/out/ota.repository.js';
import type { ListOtas, OtaOverview } from './ports/in/list-otas.port.js';

/**
 * La consulta de agencias (plan, A3 y D3): una consulta de solo lectura, con el conteo de las reservas
 * activas de cada agencia. Una agencia desconectada sigue apareciendo.
 */
@Injectable()
export class ListOtasService implements ListOtas {
  constructor(
    @Inject(OTA_REPOSITORY)
    private readonly otas: OtaRepository,
  ) {}

  execute(): Promise<OtaOverview[]> {
    return this.otas.listOverviews();
  }
}
