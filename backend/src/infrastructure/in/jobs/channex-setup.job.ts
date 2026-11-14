import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../../application/ports/out/channex-setup-state.js';
import {
  ENSURE_CHANNEX_SETUP,
  type EnsureChannexSetup,
} from '../../../application/use-cases/configure-ota/ports/in/ensure-channex-setup.port.js';
import type { ChannexVerification } from '../../../application/use-cases/configure-ota/ports/in/verify-channex-property.port.js';

/** El nombre del temporizador del reintento en el `SchedulerRegistry`. */
export const CHANNEX_SETUP_RETRY = 'channex-setup-retry';

/** Espera si no hay configuración válida (no se usa: sin configuración, `ensure()` da `DISABLED`). */
const FALLBACK_INTERVAL_SECONDS = 30;

/**
 * Llama a `EnsureChannexSetup` al arrancar (`configure-ota`, B1, "Quién lo llama"). Si da `RETRY`, o si
 * falla por un error inesperado, lo repite cada `CHANNEX_SYNC_INTERVAL_SECONDS` hasta que dé `READY` o
 * `DISABLED`. No bloquea el arranque: el resto del Módulo 2 funciona mientras tanto.
 */
@Injectable()
export class ChannexSetupJob
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ChannexSetupJob.name);

  constructor(
    @Inject(ENSURE_CHANNEX_SETUP)
    private readonly setup: EnsureChannexSetup,
    @Inject(CHANNEX_SETUP_STATE)
    private readonly state: ChannexSetupState,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    void this.attempt();
  }

  onApplicationShutdown(): void {
    this.clearRetry();
  }

  /** Un intento; si hay que reintentar, programa el siguiente. */
  async attempt(): Promise<ChannexVerification> {
    this.clearRetry();
    let result: ChannexVerification;
    try {
      result = await this.setup.ensure();
    } catch (error) {
      this.logger.error(
        'La configuración de Channex falló por un error inesperado: se reintenta',
        error instanceof Error ? error.stack : String(error),
      );
      result = 'RETRY';
    }
    if (result === 'RETRY') {
      this.scheduleRetry();
    }
    return result;
  }

  private scheduleRetry(): void {
    const seconds =
      this.state.settings()?.syncIntervalSeconds ?? FALLBACK_INTERVAL_SECONDS;
    this.scheduler.addTimeout(
      CHANNEX_SETUP_RETRY,
      setTimeout(() => void this.attempt(), seconds * 1_000),
    );
  }

  private clearRetry(): void {
    if (this.scheduler.doesExist('timeout', CHANNEX_SETUP_RETRY)) {
      this.scheduler.deleteTimeout(CHANNEX_SETUP_RETRY);
    }
  }
}
