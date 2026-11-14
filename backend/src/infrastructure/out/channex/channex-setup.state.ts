import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChannexSettings,
  ChannexSetupState,
} from '../../../application/ports/out/channex-setup-state.js';
import { readChannexConfig } from '../../config/channex.config.js';

/**
 * El estado de Channex en la memoria del proceso (`configure-ota`, B0). Valida la configuración al
 * crearse: si falla, lo registra nombrando las variables (nunca sus valores) y las tareas quedan
 * apagadas. La verificación de la propiedad la decide `VerifyChannexProperty`.
 */
@Injectable()
export class InMemoryChannexSetupState implements ChannexSetupState {
  private readonly logger = new Logger(InMemoryChannexSetupState.name);
  private readonly validSettings: ChannexSettings | null;
  private ready = false;
  private disabled = false;

  constructor(config: ConfigService) {
    const result = readChannexConfig((name) => config.get<string>(name));
    if (result.valid) {
      this.validSettings = result.settings;
    } else {
      this.validSettings = null;
      this.logger.error(
        `Configuración de Channex incompleta o inválida (${result.invalid.join(', ')}): las tareas de Channex quedan apagadas`,
      );
    }
  }

  settings(): ChannexSettings | null {
    return this.validSettings;
  }

  isReady(): boolean {
    return this.validSettings !== null && this.ready && !this.disabled;
  }

  isDisabled(): boolean {
    return this.validSettings === null || this.disabled;
  }

  markReady(): void {
    if (!this.isDisabled()) {
      this.ready = true;
    }
  }

  disable(): void {
    this.disabled = true;
    this.ready = false;
  }
}
