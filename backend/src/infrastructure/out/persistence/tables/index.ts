import { OtaTable } from './ota.table.js';
import {
  GuestTable,
  ReservationRoomTable,
  ReservationTable,
} from './reservation.tables.js';

/** Las clases de tabla de TypeORM. Al crear una nueva, agrégala a esta lista. */
export const TABLES = [
  ReservationTable,
  ReservationRoomTable,
  GuestTable,
  OtaTable,
];
