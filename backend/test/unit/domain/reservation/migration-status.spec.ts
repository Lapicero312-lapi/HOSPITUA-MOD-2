import { describe, expect, it } from 'vitest';
import { deriveMigrationStatus } from '../../../../src/domain/reservation/migration-status.js';
import type {
  MigrationStatus,
  ReservationStatus,
} from '../../../../src/domain/shared/enums.js';

describe('deriveMigrationStatus (plan, "`migrationStatus`")', () => {
  it.each<[ReservationStatus, boolean, MigrationStatus]>([
    ['ACTIVE', false, 'AWAITING_CHECK_IN'],
    ['ACTIVE', true, 'AWAITING_CHECK_IN'],
    ['PENDING', false, 'AWAITING_CHECK_IN'],
    ['PENDING', true, 'AWAITING_CHECK_IN'],
    ['CANCELLED', false, 'NO_CHECK_IN'],
    ['CANCELLED', true, 'NO_CHECK_IN'],
    ['NO_SHOW', false, 'NO_CHECK_IN'],
    ['NO_SHOW', true, 'NO_CHECK_IN'],
    ['IN_PROGRESS', true, 'COMPLETE'],
    ['COMPLETED', true, 'COMPLETE'],
    ['IN_PROGRESS', false, 'NOT_REQUIRED'],
    ['COMPLETED', false, 'NOT_REQUIRED'],
  ])(
    '%s con movimientos de extranjeros = %s da %s',
    (status, hasForeignMovement, expected) => {
      expect(deriveMigrationStatus(status, hasForeignMovement)).toBe(expected);
    },
  );
});
