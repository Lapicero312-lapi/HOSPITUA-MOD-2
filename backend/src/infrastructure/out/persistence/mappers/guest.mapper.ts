import { Guest } from '../../../../domain/guest/guest.js';
import type { DocumentType } from '../../../../domain/shared/enums.js';
import { GuestTable } from '../tables/reservation.tables.js';

export function guestToDomain(row: GuestTable): Guest {
  return Guest.restore({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    documentType: row.documentType as DocumentType | null,
    documentNumber: row.documentNumber,
    nationality: row.nationality,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
  });
}

export function guestToTable(guest: Guest, reservationId: string): GuestTable {
  return Object.assign(new GuestTable(), {
    id: guest.id,
    reservationId,
    firstName: guest.firstName,
    lastName: guest.lastName,
    documentType: guest.documentType,
    documentNumber: guest.documentNumber,
    nationality: guest.nationality,
    contactPhone: guest.contactPhone,
    contactEmail: guest.contactEmail,
  });
}
