import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  RESERVATION_PAGE_SIZE,
  type BlockingRoom,
  type DailyListArrival,
  type ExpectedArrivalsAndDepartures,
  type NightBlockingRooms,
  type ReservationListFilters,
  type ReservationListPage,
  type ReservationQueryPort,
} from '../../../../application/ports/out/reservation-query.port.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { reservationToDomain } from '../mappers/reservation.mapper.js';
import { ReservationTable } from '../tables/reservation.tables.js';
import { managerFor } from '../typeorm-transaction.js';

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

  async blockingRoomsByCategory(
    categoryRoom: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<NightBlockingRooms[]> {
    // Una fila por noche de [dateFrom, dateTo) (date + entero = la noche), aunque ninguna habitación la
    // ocupe. La estadía [start_date, end_date) ocupa la noche si empieza ese día o antes y sale después. El
    // uuid se agrega como texto para que el driver devuelva un arreglo; el orden del texto es el del uuid.
    const rows: { night: string; room_ids: string[] }[] =
      await this.dataSource.query(
        `SELECT to_char(n.night, 'YYYY-MM-DD') AS night,
                coalesce(
                  array_agg(DISTINCT rr.room_id::text ORDER BY rr.room_id::text)
                    FILTER (WHERE rr.room_id IS NOT NULL),
                  '{}'
                ) AS room_ids
         FROM (
           SELECT $2::date + i AS night
           FROM generate_series(0, $3::date - $2::date - 1) AS i
         ) n
         LEFT JOIN reservation_room rr
           ON rr.blocks_inventory
          AND rr.category_room = $1
          AND rr.start_date <= n.night
          AND rr.end_date > n.night
         GROUP BY n.night
         ORDER BY n.night`,
        [categoryRoom, dateFrom, dateTo],
      );
    return rows.map((row) => ({ date: row.night, roomIds: row.room_ids }));
  }

  async listReservations(
    filters: ReservationListFilters,
    page: number,
  ): Promise<ReservationListPage> {
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(`La página ${page} no es un entero de 1 en adelante.`);
    }
    const { where, params } = whereOf(filters);
    // "Consulta del listado", paso 1: los totales con los mismos filtros.
    const [{ total }]: { total: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM reservation r ${where}`,
      params,
    );
    // Paso 2: los ids de la página. El sentido viene de un tipo cerrado, nunca del cliente tal cual.
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
    const pageRows: { id: string }[] = await this.dataSource.query(
      `SELECT r.id FROM reservation r ${where}
       ORDER BY r.start_date ${direction}, r.reservation_ref ${direction}
       LIMIT ${RESERVATION_PAGE_SIZE} OFFSET $${params.length + 1}`,
      [...params, (page - 1) * RESERVATION_PAGE_SIZE],
    );
    const ids = pageRows.map((row) => row.id);
    if (ids.length === 0) {
      return { totalItems: total, items: [] };
    }
    // Paso 3: esas reservas con su titular, sus habitaciones, su agencia y sus movimientos.
    const [loaded, otaNames, foreign] = await Promise.all([
      this.dataSource.manager.find(ReservationTable, {
        where: { id: In(ids) },
        relations: { rooms: true, guest: true },
        order: { rooms: { roomNumber: 'ASC', id: 'ASC' } },
      }),
      this.otaNamesOf(ids),
      this.foreignMovementsOf(ids),
    ]);
    const byId = new Map(loaded.map((row) => [row.id, row]));
    return {
      totalItems: total,
      // En el orden del paso 2: `find` no conserva el de la lista de ids.
      items: ids.map((id) => {
        const row = byId.get(id);
        if (row === undefined) {
          throw new Error(`La reserva ${id} desapareció entre las consultas.`);
        }
        return {
          reservation: reservationToDomain(row),
          otaName: otaNames.get(id) ?? null,
          hasForeignMovement: foreign.has(id),
        };
      }),
    };
  }

  async findArrivals(
    operationalDate: string,
    tx: Transaction,
  ): Promise<DailyListArrival[]> {
    const manager = managerFor(this.dataSource, tx);
    const rows = await manager.find(ReservationTable, {
      where: { status: 'ACTIVE', startDate: operationalDate },
      relations: { rooms: true, guest: true },
      order: { reservationRef: 'ASC', rooms: { roomNumber: 'ASC', id: 'ASC' } },
    });
    const otaRows: { id: string; name: string }[] = await manager.query(
      `SELECT r.id, o.name FROM reservation r JOIN ota o ON o.id = r.ota_id
       WHERE r.status = 'ACTIVE' AND r.start_date = $1::date`,
      [operationalDate],
    );
    const otaNames = new Map(otaRows.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      reservation: reservationToDomain(row),
      otaName: otaNames.get(row.id) ?? null,
    }));
  }

  async countExpectedArrivalsAndDepartures(
    operationalDate: string,
  ): Promise<ExpectedArrivalsAndDepartures> {
    // Una sola sentencia, para que las dos cifras salgan del mismo momento de la base.
    const [row]: {
      expected_arrivals: number;
      expected_departures: number;
    }[] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM reservation
          WHERE status IN ('ACTIVE', 'PENDING') AND start_date = $1::date) AS expected_arrivals,
         (SELECT count(*)::int FROM reservation
          WHERE status = 'IN_PROGRESS' AND end_date = $1::date) AS expected_departures`,
      [operationalDate],
    );
    return {
      expectedArrivals: row.expected_arrivals,
      expectedDepartures: row.expected_departures,
    };
  }

  /** El nombre de la agencia de cada reserva `OTA` de la página. */
  private async otaNamesOf(ids: string[]): Promise<Map<string, string>> {
    const rows: { id: string; name: string }[] = await this.dataSource.query(
      `SELECT r.id, o.name FROM reservation r JOIN ota o ON o.id = r.ota_id
       WHERE r.id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * Las reservas de la página con movimientos migratorios de huéspedes extranjeros (FR-005b), con un solo
   * `EXISTS`. La nacionalidad es la regla de `isForeign`: ni `Colombia` ni vacía.
   */
  private async foreignMovementsOf(ids: string[]): Promise<Set<string>> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT page.id FROM unnest($1::uuid[]) AS page(id)
       WHERE EXISTS (
         SELECT 1 FROM guest_data gd
         JOIN migratory_movement mm ON mm.guest_data_id = gd.id
         WHERE gd.reservation_id = page.id
           AND gd.nationality <> '' AND gd.nationality <> 'Colombia'
       )`,
      [ids],
    );
    return new Set(rows.map((row) => row.id));
  }
}

/** El `WHERE` de los filtros de C1 y sus parámetros, en orden. */
function whereOf(filters: ReservationListFilters): {
  where: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (condition: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(condition(`$${params.length}`));
  };
  if (filters.status !== null) {
    add((p) => `r.status = ${p}`, filters.status);
  }
  if (filters.source !== null) {
    add((p) => `r.source = ${p}`, filters.source);
  }
  if (filters.otaId !== null) {
    add((p) => `r.ota_id = ${p}::uuid`, filters.otaId);
  }
  if (filters.inConflict) {
    conditions.push('r.conflict_reason IS NOT NULL');
  }
  if (filters.stayRange !== null) {
    // C1: rango inclusivo; la estadía se cruza si llega a más tardar el último día y sale después del primero.
    add((p) => `r.start_date <= ${p}::date`, filters.stayRange.dateTo);
    add((p) => `r.end_date > ${p}::date`, filters.stayRange.dateFrom);
  }
  return {
    where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}
