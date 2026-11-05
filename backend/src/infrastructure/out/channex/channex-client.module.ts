import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { CHANNEX_SETUP_STATE } from '../../../application/ports/out/channex-setup-state.js';
import { CHANNEX_PORT } from '../../../application/ports/out/channex.port.js';
import { ChannexHttpAdapter } from './channex-http.adapter.js';
import { InMemoryChannexSetupState } from './channex-setup.state.js';

/** Tiempo máximo de espera de cada llamada a Channex (plan base, "`ChannexPort`"). */
export const CHANNEX_TIMEOUT_MS = 10_000;

/**
 * Une `ChannexPort` con su cliente HTTP, y `ChannexSetupState` con el estado en memoria que valida la
 * configuración al arrancar (`configure-ota`, B0). La dirección, la clave y la propiedad las lee el
 * adaptador en cada llamada, porque son opcionales para arrancar. Es global: los casos de uso inyectan
 * `@Inject(CHANNEX_PORT)` y `@Inject(CHANNEX_SETUP_STATE)` sin importarlo.
 */
@Global()
@Module({
  imports: [HttpModule.register({ timeout: CHANNEX_TIMEOUT_MS })],
  providers: [
    { provide: CHANNEX_PORT, useClass: ChannexHttpAdapter },
    { provide: CHANNEX_SETUP_STATE, useClass: InMemoryChannexSetupState },
  ],
  exports: [CHANNEX_PORT, CHANNEX_SETUP_STATE],
})
export class ChannexClientModule {}
