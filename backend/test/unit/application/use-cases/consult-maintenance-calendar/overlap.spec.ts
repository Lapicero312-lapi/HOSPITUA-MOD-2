import { describe, expect, it } from 'vitest';
import { overlap } from '../../../../../src/application/use-cases/consult-maintenance-calendar/overlap.js';

/** Estadía del ejemplo del plan: del 2026-10-11 al 2026-10-14 (el 14 es la salida). */
const STAY = { startDate: '2026-10-11', endDate: '2026-10-14' };

describe('overlap', () => {
  it('cruce parcial: devuelve los días de la estadía que cubre el mantenimiento', () => {
    // Ejemplo del plan: mantenimiento del 2026-10-10 al 2026-10-12.
    expect(
      overlap(
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
        STAY,
      ),
    ).toEqual({ overlapStart: '2026-10-11', overlapEnd: '2026-10-12' });
  });

  it('cruce total: si el mantenimiento cubre toda la estadía, el cruce termina el día anterior a la salida', () => {
    expect(
      overlap(
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-14' },
        STAY,
      ),
    ).toEqual({ overlapStart: '2026-10-11', overlapEnd: '2026-10-13' });
  });

  it('contiguo: un mantenimiento que termina justo antes de la llegada no cruza', () => {
    // Ejemplo del plan (escenario 3): el mantenimiento termina el 2026-10-10.
    expect(
      overlap(
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-10' },
        STAY,
      ),
    ).toBeNull();
  });

  it('un solo día: un mantenimiento de un solo día dentro de la estadía cruza solo ese día', () => {
    expect(
      overlap(
        { maintenanceStart: '2026-10-12', maintenanceEnd: '2026-10-12' },
        STAY,
      ),
    ).toEqual({ overlapStart: '2026-10-12', overlapEnd: '2026-10-12' });
  });
});
