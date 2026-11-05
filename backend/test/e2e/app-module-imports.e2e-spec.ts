import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { GenerateDirectReservationModule } from '../../src/application/use-cases/generate-direct-reservation/generate-direct-reservation.module.js';

/**
 * `AppModule` importa los módulos de los casos de uso (plan base, regla 4). Se revisan sus imports y no
 * solo que la aplicación entregue el servicio: si otro módulo (como `RestModule`) también lo importa, el
 * servicio existiría aunque `AppModule` lo olvidara.
 */
describe('AppModule importa los módulos de los casos de uso', () => {
  it.each([
    ['GenerateDirectReservationModule', GenerateDirectReservationModule],
  ])('%s', (_name, module) => {
    const imports: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? [];

    expect(imports).toContain(module);
  });
});
