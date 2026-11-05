import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  BlockingRoom,
  ReservationQueryPort,
} from '../../../../application/ports/out/reservation-query.port.js';

/**
 * `ReservationQueryPort` sobre PostgreSQL (`check-view-reservation`, `TypeOrmReservationQuery`): solo
 * lee, nunca escribe.
 */
@Injectable()
export class TypeOrmReservationQuery implements ReservationQueryPort {
  constructor(private readonly dataSource: DataSource) {}

  async findBlockingRooms(
    roomIds: string[],
    startDate: string,
    endDate: string,
    excludeReservationRef?: string,
  ): Promise<BlockingRoom[]> {
    // La consulta de A1 de `check-room-availability`. `blocks_inventory` ya junta el estado de la reserva
    // y el de la habitación, y las fechas de la habitación son copia de las de la reserva (D3).
    const rows: { room_id: string; reservation_ref: string }[] =
      await this.dataSource.query(
        `SELECT rr.room_id, r.reservation_ref
         FROM reservation_room rr
         JOIN reservation r ON r.id = rr.reservation_id
         WHERE rr.blocks_inventory
           AND rr.room_id = ANY($1::uuid[])
           AND daterange(rr.start_date, rr.end_date, '[)') && daterange($2::date, $3::date, '[)')
           AND ($4::text IS NULL OR r.reservation_ref <> $4)
         ORDER BY rr.room_id, r.reservation_ref`,
        [roomIds, startDate, endDate, excludeReservationRef ?? null],
      );
    return rows.map((row) => ({
      roomId: row.room_id,
      reservationRef: row.reservation_ref,
    }));
  }
}
