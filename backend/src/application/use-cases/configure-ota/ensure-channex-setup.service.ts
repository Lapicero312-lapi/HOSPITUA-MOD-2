import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  MANAGE_OTA,
  type ManageOta,
} from '../register-ota-information-commission/ports/in/manage-ota.port.js';
import {
  BOOKING_OTA_NAME,
  type EnsureChannexSetup,
} from './ports/in/ensure-channex-setup.port.js';
import {
  SYNC_ROOM_TYPES,
  type SyncRoomTypes,
} from './ports/in/sync-room-types.port.js';
import {
  VERIFY_CHANNEX_PROPERTY,
  type ChannexVerification,
  type VerifyChannexProperty,
} from './ports/in/verify-channex-property.port.js';

/**
 * B1 de `configure-ota`: verifica la propiedad y, si está lista, registra la agencia Booking.com en
 * `CONNECTED` y sin porcentaje (lo calcula `register-ota-information-commission` con su primera reserva) y
 * sincroniza los tipos de habitación (C1, T007).
 */
@Injectable()
export class EnsureChannexSetupService implements EnsureChannexSetup {
  private readonly logger = new Logger(EnsureChannexSetupService.name);

  constructor(
    @Inject(VERIFY_CHANNEX_PROPERTY)
    private readonly verification: VerifyChannexProperty,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(SYNC_ROOM_TYPES)
    private readonly roomTypes: SyncRoomTypes,
  ) {}

  async ensure(): Promise<ChannexVerification> {
    const result = await this.verification.verify();
    if (result === 'READY') {
      // Idempotente: si la agencia ya existe, no la cambia.
      await this.otas.register({ name: BOOKING_OTA_NAME }, this.clock.now());
      // Paso 3: un `NOT_SYNCED` ya quedó en el log y no cambia el resultado: la configuración está lista y
      // los tipos se vuelven a sincronizar a las 03:00 (T011). La disponibilidad de los tipos nuevos la envía
      // `PublishDailyAvailability` cuando exista (T011); hasta entonces quedan en 0, como nacen en Channex.
      try {
        await this.roomTypes.sync();
      } catch (error) {
        // Un error inesperado (por ejemplo, la base al guardar la relación) tampoco lo cambia (C1, T007).
        this.logger.error(
          'La sincronización de tipos de habitación falló por un error inesperado: se intenta en la siguiente.',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return result;
  }
}
