import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { MigratoryMovementRepository } from '../../../../application/ports/out/migratory-movement.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { MigratoryMovement } from '../../../../domain/migration/migratory-movement.js';
import { managerFor } from '../typeorm-transaction.js';

/** `MigratoryMovementRepository` sobre la tabla `migratory_movement` (la crea la migración base). */
@Injectable()
export class TypeOrmMigratoryMovementRepository implements MigratoryMovementRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insertMissing(
    movements: MigratoryMovement[],
    tx: Transaction,
  ): Promise<number> {
    if (movements.length === 0) {
      return 0;
    }
    // RETURNING solo devuelve las filas creadas: las que chocan con el único no cuentan.
    const created: { id: string }[] = await managerFor(
      this.dataSource,
      tx,
    ).query(
      `INSERT INTO migratory_movement (id, guest_data_id, movement_type, movement_date)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::date[])
       ON CONFLICT (guest_data_id, movement_type) DO NOTHING
       RETURNING id`,
      [
        movements.map((movement) => movement.id),
        movements.map((movement) => movement.guestDataId),
        movements.map((movement) => movement.movementType),
        movements.map((movement) => movement.movementDate),
      ],
    );
    return created.length;
  }
}
