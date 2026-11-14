import { addDays } from './dates.js';

/**
 * @typedef {{ id: string; roomNumber: string; categoryRoom: string; maxCapacity: number }} Room
 * @typedef {{ maintenanceStart: string; maintenanceEnd: string }} Maintenance
 */

/**
 * Una habitación con un `id` fijo, para poder consultarla por `roomId`.
 * @param {string} id
 * @param {string} roomNumber
 * @param {string} categoryRoom
 * @param {number} maxCapacity
 * @returns {Room}
 */
const room = (id, roomNumber, categoryRoom, maxCapacity) =>
  Object.freeze({ id, roomNumber, categoryRoom, maxCapacity });

/**
 * Las habitaciones vendibles (plan base, "Simuladores del Módulo 1 y del Módulo 3"): primero las de los
 * ejemplos de los planes (`consult-room-inventory`, A2 y C1), la 201 y la 202 de `DOBLE`, la 1001 de
 * `DOBLE` y la 101 de `SUITE_JUNIOR`, con sus mismos `id`; después las de la demo, hasta 20 en cinco
 * categorías.
 * @type {readonly Room[]}
 */
export const ROOMS = Object.freeze([
  room('3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70', '201', 'DOBLE', 2),
  room('7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51', '202', 'DOBLE', 3),
  room('c8e4b2a6-5d7f-4a1c-8e3b-9f0a1b2c3d42', '1001', 'DOBLE', 2),
  room('5b9f3d7c-2e4a-4b6d-a8c1-7e6f5d4c3b23', '101', 'SUITE_JUNIOR', 2),
  room('d0e10001-0000-4000-8000-000000000102', '102', 'INDIVIDUAL', 1),
  room('d0e10001-0000-4000-8000-000000000103', '103', 'INDIVIDUAL', 1),
  room('d0e10001-0000-4000-8000-000000000104', '104', 'INDIVIDUAL', 1),
  room('d0e10001-0000-4000-8000-000000000105', '105', 'INDIVIDUAL', 1),
  room('d0e10001-0000-4000-8000-000000000203', '203', 'DOBLE', 2),
  room('d0e10001-0000-4000-8000-000000000204', '204', 'DOBLE', 2),
  room('d0e10001-0000-4000-8000-000000000205', '205', 'DOBLE', 3),
  room('d0e10001-0000-4000-8000-000000000301', '301', 'TRIPLE', 3),
  room('d0e10001-0000-4000-8000-000000000302', '302', 'TRIPLE', 3),
  room('d0e10001-0000-4000-8000-000000000303', '303', 'TRIPLE', 4),
  room('d0e10001-0000-4000-8000-000000000304', '304', 'TRIPLE', 4),
  room('d0e10001-0000-4000-8000-000000000401', '401', 'SUITE_JUNIOR', 2),
  room('d0e10001-0000-4000-8000-000000000402', '402', 'SUITE_JUNIOR', 3),
  room('d0e10001-0000-4000-8000-000000000501', '501', 'SUITE', 4),
  room('d0e10001-0000-4000-8000-000000000502', '502', 'SUITE', 4),
  room('d0e10001-0000-4000-8000-000000000503', '503', 'SUITE', 5),
]);

/**
 * El `id` de la habitación con ese número.
 * @param {string} roomNumber
 */
const idOf = (roomNumber) => {
  const found = ROOMS.find((item) => item.roomNumber === roomNumber);
  if (found === undefined) {
    throw new Error(`No hay habitación ${roomNumber} en el simulador.`);
  }
  return found.id;
};

/**
 * Los mantenimientos de cada habitación, con fechas relativas a hoy para que siempre caigan en los
 * próximos 30 días (plan base, "Simuladores del Módulo 1 y del Módulo 3"):
 * - la 201, del día 9 al 11 después de hoy, como el ejemplo de C1 (del 2026-10-20 al 2026-10-22 con hoy en
 *   el 2026-10-11);
 * - la 1001, uno que ya empezó: de ayer a mañana;
 * - la 103, del día 3 al 4;
 * - la 301 y la 302, de la misma categoría a la vez: del día 5 al 7 y del 5 al 6;
 * - la 501, del día 15 al 18;
 * - la 204, del día 20 al 21.
 * Las demás no tienen.
 * @param {string} today `AAAA-MM-DD`
 * @returns {Map<string, Maintenance[]>}
 */
export function maintenancesFrom(today) {
  /** @param {number} from @param {number} to @returns {Maintenance[]} */
  const between = (from, to) => [
    {
      maintenanceStart: addDays(today, from),
      maintenanceEnd: addDays(today, to),
    },
  ];
  return new Map([
    [idOf('201'), between(9, 11)],
    [idOf('1001'), between(-1, 1)],
    [idOf('103'), between(3, 4)],
    [idOf('301'), between(5, 7)],
    [idOf('302'), between(5, 6)],
    [idOf('501'), between(15, 18)],
    [idOf('204'), between(20, 21)],
  ]);
}

/**
 * La tarifa fija por noche de cada categoría, en `COP` y en centavos, para sumar sin decimales. `DOBLE` y la
 * suite junior son las del ejemplo de `calculate-dynamic-rate` (220000.00 y 480000.00).
 * @type {ReadonlyMap<string, number>}
 */
export const NIGHTLY_RATES_IN_CENTS = new Map([
  ['INDIVIDUAL', 15_000_000],
  ['DOBLE', 22_000_000],
  ['TRIPLE', 30_000_000],
  ['SUITE_JUNIOR', 48_000_000],
  ['SUITE', 65_000_000],
]);

export const QUOTE_CURRENCY = 'COP';
