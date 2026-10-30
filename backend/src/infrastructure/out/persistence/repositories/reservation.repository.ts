import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  In,
  Not,
  QueryFailedError,
  type FindOptionsWhere,
} from 'typeorm';
import {
  DuplicateConfirmationCodeError,
  DuplicateReservationRefError,
  RoomOverlapError,
  type ReservationRepository,
} from '../../../../application/ports/out/reservation.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import type { Reservation } from '../../../../domain/reservation/reservation.js';
import { BusinessError } from '../../../../domain/shared/business-error.js';
import {
  reservationToDomain,
  reservationToRows,
} from '../mappers/reservation.mapper.js';
import {
  GuestTable,
  ReservationRoomTable,
  ReservationTable,
} from '../tables/reservation.tables.js';
import { inTransaction, managerFor } from '../typeorm-transaction.js';

@Injectable()
export class TypeOrmReservationRepository implements ReservationRepository {
  constructor(private readonly dataSource: DataSource) {}

  findById(id: string, tx?: Transaction): Promise<Reservation | null> {
    return load(managerFor(this.dataSource, tx), { id });
  }

  findByRef(
    reservationRef: string,
    tx?: Transaction,
  ): Promise<Reservation | null> {
    return load(managerFor(this.dataSource, tx), { reservationRef });
  }

  async existsOtaConfirmationCode(
    otaId: string,
    externalConfirmationCode: string,
    tx?: Transaction,
  ): Promise<boolean> {
    const rows: unknown[] = await managerFor(this.dataSource, tx).query(
      'SELECT 1 FROM reservation WHERE ota_id = $1 AND external_confirmation_code = $2 LIMIT 1',
      [otaId, externalConfirmationCode],
    );
    return rows.length > 0;
  }

  async lockByRef(
    reservationRef: string,
    tx: Transaction,
  ): Promise<Reservation | null> {
    const manager = managerFor(this.dataSource, tx);
    // Se bloquea solo la fila de la reserva: PostgreSQL no admite FOR UPDATE con un LEFT JOIN.
    const locked: { id: string }[] = await manager.query(
      'SELECT id FROM reservation WHERE reservation_ref = $1 FOR UPDATE',
      [reservationRef],
    );
    return locked.length > 0 ? load(manager, { id: locked[0].id }) : null;
  }

  insert(reservation: Reservation, tx?: Transaction): Promise<Reservation> {
    return translateErrors(reservation, () =>
      inTransaction(this.dataSource, tx, async (manager) => {
        const rows = reservationToRows(reservation);
        await manager.insert(ReservationTable, rows.reservation);
        await manager.insert(GuestTable, rows.guest);
        await manager.insert(ReservationRoomTable, rows.rooms);
        return loadOrFail(manager, reservation.id);
      }),
    );
  }

  update(reservation: Reservation, tx?: Transaction): Promise<Reservation> {
    const expectedUpdatedAt = reservation.updatedAt;
    if (expectedUpdatedAt === null) {
      throw new Error(
        'Una reserva que no se ha guardado no se puede actualizar.',
      );
    }
    return translateErrors(reservation, () =>
      inTransaction(this.dataSource, tx, async (manager) => {
        const rows = reservationToRows(reservation);
        await updateReservationRow(
          manager,
          rows.reservation,
          expectedUpdatedAt,
        );
        await replaceRooms(manager, reservation.id, rows.rooms);
        await updateGuestRow(manager, rows.guest);
        return loadOrFail(manager, reservation.id);
      }),
    );
  }
}

function load(
  manager: EntityManager,
  where: FindOptionsWhere<ReservationTable>,
): Promise<Reservation | null> {
  return manager
    .findOne(ReservationTable, {
      where,
      relations: { rooms: true, guest: true },
      order: { rooms: { roomNumber: 'ASC', id: 'ASC' } },
    })
    .then((row) => (row ? reservationToDomain(row) : null));
}

async function loadOrFail(
  manager: EntityManager,
  id: string,
): Promise<Reservation> {
  const reservation = await load(manager, { id });
  if (!reservation) {
    throw new Error(`La reserva ${id} no se encontró después de guardarla.`);
  }
  return reservation;
}

/**
 * Control de concurrencia optimista (plan base): solo actualiza si `updated_at` sigue igual al que se
 * leyó, comparado con sus microsegundos, y lo renueva con `now()`.
 */
async function updateReservationRow(
  manager: EntityManager,
  row: ReservationTable,
  expectedUpdatedAt: string,
): Promise<void> {
  if (!manager.queryRunner) {
    throw new Error(
      'La actualización de una reserva va siempre dentro de una transacción.',
    );
  }
  const result = await manager.queryRunner.query(
    `UPDATE reservation SET
       start_date = $3, end_date = $4, guest_count = $5, status = $6, status_reason = $7, notes = $8,
       gross_amount = $9, currency = $10, commission_percentage = $11, commission_amount = $12,
       commission_status = $13, conflict_reason = $14, conflict_detected_at = $15, updated_at = now()
     WHERE id = $1 AND updated_at = $2::timestamptz`,
    [
      row.id,
      expectedUpdatedAt,
      row.startDate,
      row.endDate,
      row.guestCount,
      row.status,
      row.statusReason,
      row.notes,
      row.grossAmount,
      row.currency,
      row.commissionPercentage,
      row.commissionAmount,
      row.commissionStatus,
      row.conflictReason,
      row.conflictDetectedAt,
    ],
    true,
  );
  if (result.affected !== 1) {
    throw new BusinessError(
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
  }
}

/** Quita las habitaciones que ya no están, actualiza las que siguen y agrega las nuevas. */
async function replaceRooms(
  manager: EntityManager,
  reservationId: string,
  rooms: ReservationRoomTable[],
): Promise<void> {
  const keptIds = rooms.map((room) => room.id);
  await manager.delete(ReservationRoomTable, {
    reservationId,
    id: Not(In(keptIds)),
  });
  const existing = await manager.findBy(ReservationRoomTable, {
    id: In(keptIds),
  });
  const existingIds = new Set(existing.map((room) => room.id));
  for (const room of rooms) {
    if (existingIds.has(room.id)) {
      await manager.update(
        ReservationRoomTable,
        { id: room.id },
        {
          roomId: room.roomId,
          roomNumber: room.roomNumber,
          categoryRoom: room.categoryRoom,
          guestCount: room.guestCount,
          roomGrossAmount: room.roomGrossAmount,
          quoteId: room.quoteId,
          currency: room.currency,
          stayStatus: room.stayStatus,
          startDate: room.startDate,
          endDate: room.endDate,
          blocksInventory: room.blocksInventory,
        },
      );
    } else {
      await manager.insert(ReservationRoomTable, room);
    }
  }
}

async function updateGuestRow(
  manager: EntityManager,
  row: GuestTable,
): Promise<void> {
  await manager.query(
    `UPDATE guest SET
       first_name = $2, last_name = $3, document_type = $4, document_number = $5, nationality = $6,
       contact_phone = $7, contact_email = $8, updated_at = now()
     WHERE reservation_id = $1`,
    [
      row.reservationId,
      row.firstName,
      row.lastName,
      row.documentType,
      row.documentNumber,
      row.nationality,
      row.contactPhone,
      row.contactEmail,
    ],
  );
}

/** Traduce las violaciones de las restricciones de la base a los errores del puerto. */
async function translateErrors<T>(
  reservation: Reservation,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof QueryFailedError) {
      const { code, constraint } = error.driverError as {
        code?: string;
        constraint?: string;
      };
      if (code === '23P01') {
        throw new RoomOverlapError();
      }
      if (code === '23505' && constraint === 'uq_reservation_reservation_ref') {
        throw new DuplicateReservationRefError(reservation.reservationRef);
      }
      if (
        code === '23505' &&
        constraint === 'uq_reservation_ota_confirmation'
      ) {
        throw new DuplicateConfirmationCodeError();
      }
    }
    throw error;
  }
}
