import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HANDLE_MAINTENANCE_NOTICE,
  type HandleMaintenanceNotice,
} from '../../../application/use-cases/configure-ota/ports/in/handle-maintenance-notice.port.js';
import { INBOUND_QUEUES } from '../../config/rabbitmq.topology.js';
import { ConsumesQueue, type InboundConsumer } from './inbound-consumer.js';
import { readMaintenanceNotice } from './maintenance-notice.reader.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

const QUEUE = INBOUND_QUEUES.MAINTENANCE.name;

/**
 * El consumidor de `m2.habitacion.mantenimiento.queue` (plan de `configure-ota`, E1; T012b), como los de
 * Check-In y Check-Out:
 * - un mensaje inutilizable deja su motivo en el log y va a la dead-letter sin procesar ni reintentar;
 * - uno válido lo procesa `HandleMaintenanceNotice`: nuevo o repetido, se confirma;
 * - un fallo temporal (la base de datos caída) sale como error y se reintenta con espera creciente.
 */
@Injectable()
@ConsumesQueue(QUEUE)
export class MaintenanceConsumer implements InboundConsumer {
  private readonly logger = new Logger(MaintenanceConsumer.name);

  constructor(
    @Inject(HANDLE_MAINTENANCE_NOTICE)
    private readonly handleMaintenanceNotice: HandleMaintenanceNotice,
  ) {}

  async handle(message: unknown): Promise<void> {
    let notice;
    try {
      notice = readMaintenanceNotice(message, QUEUE);
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        this.logger.warn(
          `Aviso de mantenimiento a la dead-letter: ${error.message}`,
        );
      }
      throw error;
    }
    await this.handleMaintenanceNotice.execute(notice);
  }
}
