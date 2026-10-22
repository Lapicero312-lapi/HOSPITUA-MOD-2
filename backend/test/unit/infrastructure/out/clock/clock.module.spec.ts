import { Injectable, Inject, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
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
  it('entrega el reloj del hotel con el símbolo CLOCK', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClockModule],
    }).compile();

    expect(moduleRef.get(CLOCK)).toBeInstanceOf(HotelClock);
  });

  it('es global: otro módulo recibe el reloj sin importarlo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClockModule, OtherModule],
    }).compile();

    expect(moduleRef.get(NeedsClock).clock).toBeInstanceOf(HotelClock);
  });
});
