import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { GuestDataRepository } from '../../../../application/ports/out/guest-data.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { GuestData } from '../../../../domain/migration/guest-data.js';
import type { DocumentType } from '../../../../domain/shared/enums.js';
import { managerFor } from '../typeorm-transaction.js';

/** Una fila de `guest_data` con la `reservation_ref` de su reserva, leída como texto. */
type GuestDataRow = {
  id: string;
  reservation_ref: string;
  document_type: string;
  document_number: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  nationality: string;
  origin_place: string | null;
  destination_place: string | null;
};

/**
 * `GuestDataRepository` sobre la tabla `guest_data` (la crea la migración base). La reserva llega por su
 * `reservationRef` y se guarda su `id`.
 */
@Injectable()
export class TypeOrmGuestDataRepository implements GuestDataRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insertMissing(
    guests: GuestData[],
    tx: Transaction,
  ): Promise<GuestData[]> {
    if (guests.length === 0) {
      return [];
    }
    const manager = managerFor(this.dataSource, tx);
    // Las filas entran en el orden del único: dos transacciones con los mismos huéspedes en distinto
    // orden (dos habitaciones de la misma reserva a la vez) se esperan en fila y no en cruz (T010).
    await manager.query(
      `INSERT INTO guest_data
         (id, reservation_id, document_type, document_number, first_name, last_name,
          birth_date, nationality, origin_place, destination_place)
       SELECT g.id, r.id, g.document_type, g.document_number, g.first_name, g.last_name,
              g.birth_date, g.nationality, g.origin_place, g.destination_place
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::date[], $8::text[], $9::text[], $10::text[])
         AS g(id, reservation_ref, document_type, document_number, first_name, last_name,
              birth_date, nationality, origin_place, destination_place)
       JOIN reservation r ON r.reservation_ref = g.reservation_ref
       ORDER BY r.id, g.document_number
       ON CONFLICT (reservation_id, document_number) DO NOTHING`,
      [
        guests.map((guest) => guest.id),
        guests.map((guest) => guest.reservationRef),
        guests.map((guest) => guest.documentType),
        guests.map((guest) => guest.documentNumber),
        guests.map((guest) => guest.firstName),
        guests.map((guest) => guest.lastName),
        guests.map((guest) => guest.birthDate),
        guests.map((guest) => guest.nationality),
        guests.map((guest) => guest.originPlace),
        guests.map((guest) => guest.destinationPlace),
      ],
    );
    // Se leen todas: las recién creadas y las que ya estaban, que no cambiaron.
    const rows: GuestDataRow[] = await manager.query(
      `SELECT gd.id::text, r.reservation_ref, gd.document_type, gd.document_number,
              gd.first_name, gd.last_name, gd.birth_date::text, gd.nationality,
              gd.origin_place, gd.destination_place
       FROM guest_data gd
       JOIN reservation r ON r.id = gd.reservation_id
       JOIN unnest($1::text[], $2::text[]) AS k(reservation_ref, document_number)
         ON k.reservation_ref = r.reservation_ref AND k.document_number = gd.document_number`,
      [
        guests.map((guest) => guest.reservationRef),
        guests.map((guest) => guest.documentNumber),
      ],
    );
    const stored = new Map(
      rows.map((row) => [keyOf(row.reservation_ref, row.document_number), row]),
    );
    return guests.map((guest) => {
      const row = stored.get(keyOf(guest.reservationRef, guest.documentNumber));
      if (!row) {
        throw new Error(`La reserva ${guest.reservationRef} no existe.`);
      }
      return toGuestData(row);
    });
  }
}

function keyOf(reservationRef: string, documentNumber: string): string {
  return JSON.stringify([reservationRef, documentNumber]);
}

function toGuestData(row: GuestDataRow): GuestData {
  return GuestData.restore({
    id: row.id,
    reservationRef: row.reservation_ref,
    // La base solo acepta los seis tipos (CHECK de la migración base).
    documentType: row.document_type as DocumentType,
    documentNumber: row.document_number,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    nationality: row.nationality,
    originPlace: row.origin_place,
    destinationPlace: row.destination_place,
  });
}
