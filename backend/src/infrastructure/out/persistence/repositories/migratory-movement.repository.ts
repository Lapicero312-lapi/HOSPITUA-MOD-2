import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  MigratoryMovementRepository,
  MovementWithGuest,
} from '../../../../application/ports/out/migratory-movement.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { MigratoryMovement } from '../../../../domain/migration/migratory-movement.js';
import type { MovementType } from '../../../../domain/shared/enums.js';
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

  async findWithGuestByPeriod(
    from: string,
    to: string,
  ): Promise<MovementWithGuest[]> {
    const rows: MovementRow[] = await this.dataSource.query(
      `${SELECT_WITH_GUEST} WHERE mm.movement_date BETWEEN $1::date AND $2::date`,
      [from, to],
    );
    return rows.map(toMovementWithGuest);
  }

  async findWithGuestById(
    movementId: string,
  ): Promise<MovementWithGuest | null> {
    const rows: MovementRow[] = await this.dataSource.query(
      `${SELECT_WITH_GUEST} WHERE mm.id = $1::uuid`,
      [movementId],
    );
    return rows.length === 0 ? null : toMovementWithGuest(rows[0]);
  }
}

/** El movimiento unido a su huésped y a su reserva, con las fechas como texto. */
const SELECT_WITH_GUEST = `SELECT mm.id::text AS movement_id, r.reservation_ref, mm.movement_type,
         mm.movement_date::text AS movement_date, gd.first_name, gd.last_name, gd.document_type,
         gd.document_number, gd.birth_date::text AS birth_date, gd.nationality, gd.origin_place,
         gd.destination_place
  FROM migratory_movement mm
  JOIN guest_data gd ON gd.id = mm.guest_data_id
  JOIN reservation r ON r.id = gd.reservation_id`;

type MovementRow = {
  movement_id: string;
  reservation_ref: string;
  movement_type: string;
  movement_date: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  birth_date: string;
  nationality: string;
  origin_place: string | null;
  destination_place: string | null;
};

function toMovementWithGuest(row: MovementRow): MovementWithGuest {
  return {
    movementId: row.movement_id,
    reservationRef: row.reservation_ref,
    // La base solo acepta ENTRY y DEPARTURE (CHECK de la migración base).
    movementType: row.movement_type as MovementType,
    movementDate: row.movement_date,
    guest: {
      firstName: row.first_name,
      lastName: row.last_name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      birthDate: row.birth_date,
      nationality: row.nationality,
      originPlace: row.origin_place,
      destinationPlace: row.destination_place,
    },
  };
}
