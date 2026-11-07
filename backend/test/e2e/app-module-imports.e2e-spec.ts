import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { CalculateDynamicRateModule } from '../../src/application/use-cases/calculate-dynamic-rate/calculate-dynamic-rate.module.js';
import { CancelReservationModule } from '../../src/application/use-cases/cancel-reservation/cancel-reservation.module.js';
import { CheckRoomAvailabilityModule } from '../../src/application/use-cases/check-room-availability/check-room-availability.module.js';
import { CheckViewReservationModule } from '../../src/application/use-cases/check-view-reservation/check-view-reservation.module.js';
import { GenerateDirectReservationModule } from '../../src/application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';
import { GenerateOtaReservationModule } from '../../src/application/use-cases/generate-ota-reservation/generate-ota-reservation.module.js';
import { ProcessGuestDataModule } from '../../src/application/use-cases/process-guest-data/process-guest-data.module.js';
import { UpdateReservationModule } from '../../src/application/use-cases/update-reservation/update-reservation.module.js';

/**
 * `AppModule` importa los módulos de los casos de uso (plan base, regla 4). Se revisan sus imports y no
 * solo que la aplicación entregue el servicio: si otro módulo (como `RestModule`) también lo importa, el
 * servicio existiría aunque `AppModule` lo olvidara.
 */
describe('AppModule importa los módulos de los casos de uso', () => {
  it.each([
    ['CheckViewReservationModule', CheckViewReservationModule],
    ['CheckRoomAvailabilityModule', CheckRoomAvailabilityModule],
    ['CalculateDynamicRateModule', CalculateDynamicRateModule],
    ['GenerateDirectReservationModule', GenerateDirectReservationModule],
    ['GenerateOtaReservationModule', GenerateOtaReservationModule],
    ['ProcessGuestDataModule', ProcessGuestDataModule],
    ['UpdateReservationModule', UpdateReservationModule],
    ['CancelReservationModule', CancelReservationModule],
  ])('%s', (_name, module) => {
    const imports: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? [];

    expect(imports).toContain(module);
  });
});
