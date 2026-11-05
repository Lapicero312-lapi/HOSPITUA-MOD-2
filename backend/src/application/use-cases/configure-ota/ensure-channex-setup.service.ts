import { Inject, Injectable } from '@nestjs/common';
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
  VERIFY_CHANNEX_PROPERTY,
  type ChannexVerification,
  type VerifyChannexProperty,
} from './ports/in/verify-channex-property.port.js';

/**
 * B1 de `configure-ota`: verifica la propiedad y, si está lista, registra la agencia Booking.com en
 * `CONNECTED` y sin porcentaje (lo calcula `register-ota-information-commission` con su primera reserva).
 */
@Injectable()
export class EnsureChannexSetupService implements EnsureChannexSetup {
  constructor(
    @Inject(VERIFY_CHANNEX_PROPERTY)
    private readonly verification: VerifyChannexProperty,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async ensure(): Promise<ChannexVerification> {
    const result = await this.verification.verify();
    if (result === 'READY') {
      // Idempotente: si la agencia ya existe, no la cambia.
      await this.otas.register({ name: BOOKING_OTA_NAME }, this.clock.now());
    }
    return result;
  }
}
