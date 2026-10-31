import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { CHANNEX_PORT } from '../../../application/ports/out/channex.port.js';
import { ChannexHttpAdapter } from './channex-http.adapter.js';

/** Tiempo máximo de espera de cada llamada a Channex (plan base, "`ChannexPort`"). */
export const CHANNEX_TIMEOUT_MS = 10_000;

/**
 * Une `ChannexPort` con su cliente HTTP. La dirección, la clave y la propiedad las lee el adaptador en
 * cada llamada, porque son opcionales para arrancar. Es global: los casos de uso inyectan
 * `@Inject(CHANNEX_PORT)` sin importarlo.
 */
@Global()
@Module({
  imports: [HttpModule.register({ timeout: CHANNEX_TIMEOUT_MS })],
  providers: [{ provide: CHANNEX_PORT, useClass: ChannexHttpAdapter }],
  exports: [CHANNEX_PORT],
})
export class ChannexClientModule {}
