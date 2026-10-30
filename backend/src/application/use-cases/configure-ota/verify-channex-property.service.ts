import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHANNEX_PORT,
  ChannexUnauthorizedError,
  type ChannexPort,
} from '../../ports/out/channex.port.js';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../ports/out/channex-setup-state.js';
import type {
  ChannexVerification,
  VerifyChannexProperty,
} from './ports/in/verify-channex-property.port.js';

/**
 * Verifica con A0 que `CHANNEX_PROPERTY_ID` esté entre las propiedades de la cuenta (`configure-ota`,
 * B0). Si no está, o Channex rechaza la clave, apaga las tareas de Channex hasta reiniciar. Si Channex
 * no responde, las deja sin trabajar y pide reintentar.
 */
@Injectable()
export class VerifyChannexPropertyService implements VerifyChannexProperty {
  private readonly logger = new Logger(VerifyChannexPropertyService.name);

  constructor(
    @Inject(CHANNEX_PORT)
    private readonly channex: ChannexPort,
    @Inject(CHANNEX_SETUP_STATE)
    private readonly state: ChannexSetupState,
  ) {}

  async verify(): Promise<ChannexVerification> {
    const settings = this.state.settings();
    if (settings === null || this.state.isDisabled()) {
      return 'DISABLED';
    }
    if (this.state.isReady()) {
      return 'READY';
    }

    let properties: { id: string }[];
    try {
      properties = await this.channex.listProperties();
    } catch (error) {
      if (error instanceof ChannexUnauthorizedError) {
        this.logger.error(
          `Channex rechazó la clave de acceso (${error.status}): las tareas de Channex quedan apagadas`,
        );
        this.state.disable();
        return 'DISABLED';
      }
      this.logger.warn(
        `No se pudo verificar la propiedad en Channex (${errorName(error)}): se reintenta en ${settings.syncIntervalSeconds} s`,
      );
      return 'RETRY';
    }

    if (
      !properties.some(
        (property) => property.id.toLowerCase() === settings.propertyId,
      )
    ) {
      this.logger.error(
        'La propiedad configurada (CHANNEX_PROPERTY_ID) no existe en Channex: las tareas de Channex quedan apagadas',
      );
      this.state.disable();
      return 'DISABLED';
    }
    this.state.markReady();
    this.logger.log('Propiedad de Channex verificada');
    return 'READY';
  }
}

/** El nombre del error, sin su mensaje (la clave nunca está ahí, pero el detalle sobra en el log). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'error desconocido';
}
