import { Global, Module } from '@nestjs/common';
import { CLOCK } from '../../../application/ports/out/clock.js';
import { HotelClock } from './hotel-clock.js';

/**
 * Une el puerto `Clock` con el reloj del hotel. Es global: cualquier caso de uso lo recibe con
 * `@Inject(CLOCK)` sin importar este módulo, y nunca crea su propio `HotelClock`.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: HotelClock }],
  exports: [CLOCK],
})
export class ClockModule {}
