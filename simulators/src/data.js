import { addDays } from './dates.js';

/**
 * @typedef {{ id: string; roomNumber: string; categoryRoom: string; maxCapacity: number }} Room
 * @typedef {{ maintenanceStart: string; maintenanceEnd: string }} Maintenance
 */

/**
 * Las habitaciones de los ejemplos de los planes (`consult-room-inventory`, A2 y C1, y sus datos de
 * prueba): la 201 y la 202 de `DOBLE`, la 1001 de `DOBLE` y la 101 de `SUITE_JUNIOR`. Los `id` son fijos
 * para poder consultarlas por `roomId`.
 * @type {readonly Room[]}
 */
export const ROOMS = Object.freeze([
  {
    id: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
    roomNumber: '201',
    categoryRoom: 'DOBLE',
    maxCapacity: 2,
  },
  {
    id: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
    roomNumber: '202',
    categoryRoom: 'DOBLE',
    maxCapacity: 3,
  },
  {
    id: 'c8e4b2a6-5d7f-4a1c-8e3b-9f0a1b2c3d42',
    roomNumber: '1001',
    categoryRoom: 'DOBLE',
    maxCapacity: 2,
  },
  {
    id: '5b9f3d7c-2e4a-4b6d-a8c1-7e6f5d4c3b23',
    roomNumber: '101',
    categoryRoom: 'SUITE_JUNIOR',
    maxCapacity: 2,
  },
]);

/**
 * Los mantenimientos de cada habitación, con fechas relativas a hoy para que siempre caigan en los
 * próximos 30 días (plan base, "Simuladores del Módulo 1 y del Módulo 3"):
 * - la 201, del día 9 al 11 después de hoy, como el ejemplo de C1 (del 2026-10-20 al 2026-10-22 con hoy en
 *   el 2026-10-11);
 * - la 1001, uno que ya empezó: de ayer a mañana.
 * Las demás no tienen.
 * @param {string} today `AAAA-MM-DD`
 * @returns {Map<string, Maintenance[]>}
 */
export function maintenancesFrom(today) {
  return new Map([
    [
      ROOMS[0].id,
      [
        {
          maintenanceStart: addDays(today, 9),
          maintenanceEnd: addDays(today, 11),
        },
      ],
    ],
    [
      ROOMS[2].id,
      [
        {
          maintenanceStart: addDays(today, -1),
          maintenanceEnd: addDays(today, 1),
        },
      ],
    ],
  ]);
}

/**
 * La tarifa fija por noche de cada categoría, en `COP` y en centavos, para sumar sin decimales. Son las
 * del ejemplo de `calculate-dynamic-rate` (`DOBLE` 220000.00 y la suite 480000.00).
 * @type {ReadonlyMap<string, number>}
 */
export const NIGHTLY_RATES_IN_CENTS = new Map([
  ['DOBLE', 22_000_000],
  ['SUITE_JUNIOR', 48_000_000],
]);

export const QUOTE_CURRENCY = 'COP';
