import { describe, expect, it } from 'vitest';
import { canChangeConnectionStatus } from '../../../../src/domain/ota/connection-status.js';
import {
  CONNECTION_STATUSES,
  type ConnectionStatus,
} from '../../../../src/domain/shared/enums.js';

/**
 * Las transiciones del plan ("`CONNECTED` ⇄ `DISCONNECTED`") y del spec (US3, escenarios 3 y 4).
 * Quedarse en el mismo estado no es una transición.
 */
const PLAN_CONNECTION_TRANSITIONS = [
  'CONNECTED→DISCONNECTED',
  'DISCONNECTED→CONNECTED',
];

describe('Transiciones de connectionStatus', () => {
  it.each(
    CONNECTION_STATUSES.flatMap((from) =>
      CONNECTION_STATUSES.map((to): [ConnectionStatus, ConnectionStatus] => [
        from,
        to,
      ]),
    ),
  )('%s → %s', (from, to) => {
    expect(canChangeConnectionStatus(from, to)).toBe(
      PLAN_CONNECTION_TRANSITIONS.includes(`${from}→${to}`),
    );
  });
});
