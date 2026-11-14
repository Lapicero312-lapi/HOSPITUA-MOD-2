import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotelClock } from '../../../../../src/infrastructure/out/clock/hotel-clock.js';

/** Día de Colombia (`America/Bogota`) calculado sin `luxon`, para comparar con el reloj. */
function colombiaDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
  }).format(instant);
}

describe('HotelClock', () => {
  const clock = new HotelClock();

  describe('con la hora real', () => {
    it('today() es el día de Colombia como AAAA-MM-DD', () => {
      const before = colombiaDate(new Date());
      const today = clock.today();
      const after = colombiaDate(new Date());

      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([before, after]).toContain(today);
    });

    it('now() es el instante en que se consulta', () => {
      const before = Date.now();
      const now = clock.now();
      const after = Date.now();

      expect(now).toBeInstanceOf(Date);
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(after);
    });
  });

  // Se fija la hora que ve la prueba (no la del computador) para recorrer el cambio de día.
  describe('el día operativo va de 00:00 a 23:59 en Colombia', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('a las 00:00 en Colombia ya es el día nuevo', () => {
      vi.setSystemTime(new Date('2026-10-09T00:00:00.000-05:00'));

      expect(clock.today()).toBe('2026-10-09');
    });

    it('a las 23:59:59.999 en Colombia todavía es el mismo día', () => {
      vi.setSystemTime(new Date('2026-10-09T23:59:59.999-05:00'));

      expect(clock.today()).toBe('2026-10-09');
    });

    it('al adelantar la hora pasa al día siguiente justo a la medianoche', () => {
      vi.setSystemTime(new Date('2026-10-09T23:59:59.999-05:00'));
      expect(clock.today()).toBe('2026-10-09');

      vi.advanceTimersByTime(1);

      expect(clock.today()).toBe('2026-10-10');
    });

    it('usa el día de Colombia aunque en UTC ya sea el día siguiente', () => {
      // 2026-10-10 04:59 en UTC son las 23:59 del 9 en Colombia.
      vi.setSystemTime(new Date('2026-10-10T04:59:00.000Z'));

      expect(clock.today()).toBe('2026-10-09');
    });

    it('now() devuelve el instante que corresponde a la hora fijada', () => {
      // 00:00:30 es la hora del cierre del día (plan base).
      const instant = new Date('2026-10-09T00:00:30.000-05:00');
      vi.setSystemTime(instant);

      expect(clock.now().getTime()).toBe(instant.getTime());
    });
  });
});
