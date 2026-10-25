import { Injectable, Inject, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLOCK,
  type Clock,
} from '../../../../../src/application/ports/out/clock.js';
import { ClockModule } from '../../../../../src/infrastructure/out/clock/clock.module.js';
import { HotelClock } from '../../../../../src/infrastructure/out/clock/hotel-clock.js';

/** Un servicio de otro módulo, que no importa `ClockModule`, como lo haría un caso de uso. */
@Injectable()
class NeedsClock {
  constructor(@Inject(CLOCK) readonly clock: Clock) {}
}

@Module({ providers: [NeedsClock] })
class OtherModule {}

describe('ClockModule', () => {
  let moduleRef: TestingModule;

  // Arrancar Nest por primera vez puede tardar más que el tiempo de una prueba: se hace una sola vez.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ClockModule, OtherModule],
    }).compile();
  }, 30_000);

  it('entrega el reloj del hotel con el símbolo CLOCK', () => {
    expect(moduleRef.get(CLOCK)).toBeInstanceOf(HotelClock);
  });

  it('es global: otro módulo recibe el reloj sin importarlo', () => {
    expect(moduleRef.get(NeedsClock).clock).toBeInstanceOf(HotelClock);
  });
});
