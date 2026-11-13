import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  GuestStayCriteria,
  GuestStayDetailRow,
  GuestStayQuery,
  GuestStayRow,
} from '../../../../application/ports/out/guest-stay.query.js';
import type {
  DocumentType,
  MovementType,
} from '../../../../domain/shared/enums.js';

/**
 * Cada huésped con su entrada y su salida, solo si tiene al menos un movimiento (FR-016), y los filtros de
 * C1 (plan de `process-guest-data`, "Consulta de la vista"). Los parámetros `$1` a `$7` son los de
 * `filterParams`.
 */
const FROM_AND_FILTERS = `
  FROM guest_data gd
  JOIN reservation r ON r.id = gd.reservation_id
  LEFT JOIN migratory_movement e ON e.guest_data_id = gd.id AND e.movement_type = 'ENTRY'
  LEFT JOIN migratory_movement d ON d.guest_data_id = gd.id AND d.movement_type = 'DEPARTURE'
  WHERE (e.id IS NOT NULL OR d.id IS NOT NULL)
    AND ($1::text = 'ALL'
      OR ($1::text = 'FOREIGN' AND gd.nationality <> 'Colombia' AND gd.nationality <> '')
      OR ($1::text = 'COLOMBIAN' AND gd.nationality = 'Colombia'))
    AND ($2::text = 'ALL'
      OR ($2::text = 'IN_HOTEL' AND e.id IS NOT NULL AND d.id IS NULL)
      OR ($2::text = 'CHECKED_OUT' AND d.id IS NOT NULL))
    AND ($3::date IS NULL
      OR (COALESCE(e.movement_date, d.movement_date) <= $4::date
        AND COALESCE(d.movement_date, $5::date) >= $3::date))
    AND ($6::text IS NULL OR gd.document_number = $6::text)
    AND ($7::text IS NULL
      OR immutable_unaccent(lower(gd.first_name || ' ' || gd.last_name))
        LIKE '%' || immutable_unaccent(lower($7::text)) || '%')`;

type Row = {
  reservation_ref: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  nationality: string;
  entry_date: string | null;
  exit_date: string | null;
};

/**
 * `GuestStayQuery` sobre PostgreSQL. La búsqueda por nombre usa la misma expresión del índice trigram de
 * `guest_data` (migración base); con otra, PostgreSQL no usaría el índice.
 */
@Injectable()
export class TypeOrmGuestStayQuery implements GuestStayQuery {
  constructor(private readonly dataSource: DataSource) {}

  async count(criteria: GuestStayCriteria): Promise<number> {
    const [{ total }]: { total: number }[] = await this.dataSource.query(
      `SELECT count(*)::int AS total ${FROM_AND_FILTERS}`,
      filterParams(criteria),
    );
    return total;
  }

  async findPage(
    criteria: GuestStayCriteria,
    offset: number,
    limit: number,
  ): Promise<GuestStayRow[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT r.reservation_ref, gd.first_name, gd.last_name, gd.document_type, gd.document_number,
              gd.nationality, e.movement_date::text AS entry_date, d.movement_date::text AS exit_date
       ${FROM_AND_FILTERS}
       ORDER BY COALESCE(e.movement_date, d.movement_date) DESC, r.reservation_ref, gd.document_number
       LIMIT $8 OFFSET $9`,
      [...filterParams(criteria), limit, offset],
    );
    return rows.map((row) => ({
      reservationRef: row.reservation_ref,
      firstName: row.first_name,
      lastName: row.last_name,
      // La base solo acepta los seis tipos (CHECK de la migración base).
      documentType: row.document_type as DocumentType,
      documentNumber: row.document_number,
      nationality: row.nationality,
      entryDate: row.entry_date,
      exitDate: row.exit_date,
    }));
  }

  async findDetail(
    reservationRef: string,
    documentNumber: string,
  ): Promise<GuestStayDetailRow | null> {
    // El único (reservation_id, document_number) asegura una sola fila.
    const rows: DetailRow[] = await this.dataSource.query(
      `SELECT r.reservation_ref, gd.first_name, gd.last_name, gd.document_type, gd.document_number,
              gd.birth_date::text AS birth_date, gd.nationality, gd.origin_place, gd.destination_place,
              COALESCE(
                (SELECT json_agg(
                          json_build_object('movementType', mm.movement_type,
                                            'movementDate', mm.movement_date::text)
                          ORDER BY mm.movement_date, mm.movement_type = 'DEPARTURE')
                 FROM migratory_movement mm
                 WHERE mm.guest_data_id = gd.id),
                '[]'::json) AS movements
       FROM guest_data gd
       JOIN reservation r ON r.id = gd.reservation_id
       WHERE r.reservation_ref = $1 AND gd.document_number = $2`,
      [reservationRef, documentNumber],
    );
    if (rows.length === 0) {
      return null;
    }
    const [row] = rows;
    return {
      reservationRef: row.reservation_ref,
      firstName: row.first_name,
      lastName: row.last_name,
      // La base solo acepta los seis tipos (CHECK de la migración base).
      documentType: row.document_type as DocumentType,
      documentNumber: row.document_number,
      birthDate: row.birth_date,
      nationality: row.nationality,
      originPlace: row.origin_place,
      destinationPlace: row.destination_place,
      movements: row.movements,
    };
  }
}

/** El huésped con sus movimientos como un arreglo JSON, ya ordenado (`[]` si no tiene). */
type DetailRow = {
  reservation_ref: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  birth_date: string;
  nationality: string;
  origin_place: string | null;
  destination_place: string | null;
  movements: { movementType: MovementType; movementDate: string }[];
};

function filterParams(criteria: GuestStayCriteria): unknown[] {
  const { dateRange, search } = criteria;
  return [
    criteria.nationality,
    criteria.presence,
    dateRange?.dateFrom ?? null,
    dateRange?.dateTo ?? null,
    criteria.today,
    search?.kind === 'DOCUMENT' ? search.documentNumber : null,
    search?.kind === 'NAME' ? search.text : null,
  ];
}
