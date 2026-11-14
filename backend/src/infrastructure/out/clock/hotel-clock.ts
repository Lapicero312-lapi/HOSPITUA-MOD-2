import { DateTime } from 'luxon';
import type { Clock } from '../../../application/ports/out/clock.js';

/**
 * La zona horaria de Colombia. El día operativo es el de Colombia; es fijo y no es configurable
 * (plan base).
 */
const HOTEL_TIME_ZONE = 'America/Bogota';

/** Reloj del hotel: calcula con `luxon` el día operativo en Colombia (zona horaria `America/Bogota`). */
export class HotelClock implements Clock {
  today(): string {
    return DateTime.now().setZone(HOTEL_TIME_ZONE).toFormat('yyyy-MM-dd');
  }

  now(): Date {
    return new Date();
  }
}
