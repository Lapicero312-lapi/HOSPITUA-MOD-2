import { describe, expect, it } from 'vitest';
import {
  canChangeStatus,
  canChangeStayStatus,
  INITIAL_RESERVATION_STATUS,
  INITIAL_STAY_STATUS,
} from '../../../../src/domain/reservation/reservation-transitions.js';
import {
  RESERVATION_STATUSES,
  STAY_STATUSES,
} from '../../../../src/domain/shared/enums.js';

/**
 * Las transiciones tal como las enumeran los specs: FR-006 de `update-reservation` y la cancelación de
 * `cancel-reservation` ("ACTIVE o PENDING → CANCELLED"). Cualquier otra se rechaza.
 */
const SPEC_STATUS_TRANSITIONS = [
  'PENDING→ACTIVE',
  'ACTIVE→IN_PROGRESS',
  'IN_PROGRESS→COMPLETED',
  'ACTIVE→NO_SHOW',
  'PENDING→NO_SHOW',
  'ACTIVE→CANCELLED',
  'PENDING→CANCELLED',
];

/** FR-007 de `update-reservation`. */
const SPEC_STAY_TRANSITIONS = [
  'EXPECTED→CHECKED_IN',
  'CHECKED_IN→CHECKED_OUT',
  'EXPECTED→NOT_ARRIVED',
];

const pairs = <T extends string>(values: readonly T[]): [T, T][] =>
  values.flatMap((from) => values.map((to): [T, T] => [from, to]));

describe('Transiciones de Reservation.status (FR-006)', () => {
  it.each(pairs(RESERVATION_STATUSES))('%s → %s', (from, to) => {
    expect(canChangeStatus(from, to)).toBe(
      SPEC_STATUS_TRANSITIONS.includes(`${from}→${to}`),
    );
  });
});

describe('Transiciones de ReservationRoom.stayStatus (FR-007)', () => {
  it.each(pairs(STAY_STATUSES))('%s → %s', (from, to) => {
    expect(canChangeStayStatus(from, to)).toBe(
      SPEC_STAY_TRANSITIONS.includes(`${from}→${to}`),
    );
  });
});

it('una reserva nueva nace en ACTIVE con sus habitaciones en EXPECTED (specs de creación)', () => {
  expect(INITIAL_RESERVATION_STATUS).toBe('ACTIVE');
  expect(INITIAL_STAY_STATUS).toBe('EXPECTED');
});
