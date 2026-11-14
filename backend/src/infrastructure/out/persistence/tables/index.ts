import { AriPendingChangeTable } from './ari-pending-change.table.js';
import { OtaBookingRevisionTable } from './ota-booking-revision.table.js';
import { OtaRoomTypeMappingTable } from './ota-room-type-mapping.table.js';
import { OtaTable } from './ota.table.js';
import {
  GuestTable,
  ReservationRoomTable,
  ReservationTable,
} from './reservation.tables.js';
import { SireExportTable } from './sire-export.table.js';

/** Las clases de tabla de TypeORM. Al crear una nueva, agrégala a esta lista. */
export const TABLES = [
  ReservationTable,
  ReservationRoomTable,
  GuestTable,
  OtaTable,
  OtaRoomTypeMappingTable,
  AriPendingChangeTable,
  OtaBookingRevisionTable,
  SireExportTable,
];
