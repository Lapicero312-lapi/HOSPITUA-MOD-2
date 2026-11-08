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
import { MessagingModule } from '../../src/infrastructure/config/messaging.module.js';
import { CheckInConsumer } from '../../src/infrastructure/in/messaging/check-in.consumer.js';
import { ConsumersModule } from '../../src/infrastructure/in/messaging/consumers.module.js';

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

/**
 * La app escucha sus colas de entrada: `AppModule` importa la conexión con RabbitMQ (`MessagingModule`,
 * que registra los consumidores) y `ConsumersModule`, que declara cada consumidor. Sin cualquiera de los
 * dos, la app arranca igual pero deja de escuchar `m2.habitacion.checkin.queue` (T015 de
 * `update-reservation`).
 */
describe('AppModule escucha las colas de entrada', () => {
  it.each([
    ['MessagingModule', MessagingModule],
    ['ConsumersModule', ConsumersModule],
  ])('importa %s', (_name, module) => {
    const imports: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? [];

    expect(imports).toContain(module);
  });

  it('ConsumersModule declara CheckInConsumer', () => {
    const providers: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConsumersModule) ?? [];

    expect(providers).toContain(CheckInConsumer);
  });
});
