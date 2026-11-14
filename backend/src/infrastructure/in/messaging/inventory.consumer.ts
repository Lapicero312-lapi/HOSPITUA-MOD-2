import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HANDLE_INVENTORY_NOTICE,
  type HandleInventoryNotice,
} from '../../../application/use-cases/configure-ota/ports/in/handle-inventory-notice.port.js';
import { INBOUND_QUEUES } from '../../config/rabbitmq.topology.js';
import { ConsumesQueue, type InboundConsumer } from './inbound-consumer.js';
import { readInventoryNotice } from './inventory-notice.reader.js';
import { InvalidMessageError } from './retry-or-dead-letter.js';

const QUEUE = INBOUND_QUEUES.INVENTORY.name;

/**
 * El consumidor de `m2.habitacion.inventario.queue` (plan de `configure-ota`, E2; T012b), como el de E1:
 * - un mensaje inutilizable deja su motivo en el log y va a la dead-letter sin procesar ni reintentar;
 * - uno válido lo procesa `HandleInventoryNotice`: nuevo o repetido, se confirma;
 * - un fallo temporal (el bloqueo de Channex ocupado, la base de datos caída) sale como error y se reintenta
 *   con espera creciente.
 */
@Injectable()
@ConsumesQueue(QUEUE)
export class InventoryConsumer implements InboundConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(
    @Inject(HANDLE_INVENTORY_NOTICE)
    private readonly handleInventoryNotice: HandleInventoryNotice,
  ) {}

  async handle(message: unknown): Promise<void> {
    let notice;
    try {
      notice = readInventoryNotice(message, QUEUE);
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        this.logger.warn(
          `Aviso de inventario a la dead-letter: ${error.message}`,
        );
      }
      throw error;
    }
    await this.handleInventoryNotice.execute(notice);
  }
}
