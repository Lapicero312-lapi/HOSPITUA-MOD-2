import { HotelClock } from '../../../../../src/infrastructure/out/clock/hotel-clock.js';

/** Día en `America/Bogota` calculado sin `luxon`, para comparar con el reloj. */
function bogotaDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
  }).format(instant);
}

describe('HotelClock', () => {
  const clock = new HotelClock();

  describe('con la hora real', () => {
    it('today() es el día de Bogotá como AAAA-MM-DD', () => {
      const before = bogotaDate(new Date());
      const today = clock.today();
      const after = bogotaDate(new Date());

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
  describe('el día operativo va de 00:00 a 23:59 en Bogotá', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('a las 00:00 en Bogotá ya es el día nuevo', () => {
      vi.setSystemTime(new Date('2026-10-09T00:00:00.000-05:00'));

      expect(clock.today()).toBe('2026-10-09');
    });

    it('a las 23:59:59.999 en Bogotá todavía es el mismo día', () => {
      vi.setSystemTime(new Date('2026-10-09T23:59:59.999-05:00'));

      expect(clock.today()).toBe('2026-10-09');
    });

    it('al adelantar la hora pasa al día siguiente justo a la medianoche', () => {
      vi.setSystemTime(new Date('2026-10-09T23:59:59.999-05:00'));
      expect(clock.today()).toBe('2026-10-09');

      vi.advanceTimersByTime(1);

      expect(clock.today()).toBe('2026-10-10');
    });

    it('usa el día de Bogotá aunque en UTC ya sea el día siguiente', () => {
      // 2026-10-10 02:00 en UTC son las 21:00 del 9 en Bogotá.
      vi.setSystemTime(new Date('2026-10-10T02:00:00.000Z'));

      expect(clock.today()).toBe('2026-10-09');
    });

    it('now() devuelve el instante que corresponde a la hora fijada', () => {
      const instant = new Date('2026-10-09T15:30:00.000-05:00');
      vi.setSystemTime(instant);

      expect(clock.now().getTime()).toBe(instant.getTime());
    });
  });
});
