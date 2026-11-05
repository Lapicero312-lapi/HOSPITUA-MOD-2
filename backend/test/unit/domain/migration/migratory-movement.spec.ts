import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MigratoryMovement,
  type MigratoryMovementProps,
} from '../../../../src/domain/migration/migratory-movement.js';

/** La entrada del ejemplo de C2 del plan de `process-guest-data`. */
const PROPS: MigratoryMovementProps = {
  id: randomUUID(),
  guestDataId: randomUUID(),
  movementType: 'ENTRY',
  movementDate: '2026-10-09',
};

describe('MigratoryMovement', () => {
  it('conserva los datos con los que se crea', () => {
    const movement = MigratoryMovement.restore(PROPS);

    expect(movement.snapshot()).toEqual(PROPS);
    expect({
      id: movement.id,
      guestDataId: movement.guestDataId,
      movementType: movement.movementType,
      movementDate: movement.movementDate,
    }).toEqual(PROPS);
  });

  it('cambiar la copia no cambia el movimiento', () => {
    const movement = MigratoryMovement.restore(PROPS);

    movement.snapshot().movementDate = '2026-10-12';

    expect(movement.movementDate).toBe('2026-10-09');
  });
});
