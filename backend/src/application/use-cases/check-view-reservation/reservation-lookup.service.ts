import { Inject, Injectable } from '@nestjs/common';
import {
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import type {
  BlockingRoom,
  ReservationLookup,
} from './ports/in/reservation-lookup.port.js';

/**
 * `ReservationLookup` (plan, "`ReservationLookup.findBlockingRooms`"): delega cada búsqueda en el puerto de
 * lectura `ReservationQueryPort`.
 */
@Injectable()
export class ReservationLookupService implements ReservationLookup {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly query: ReservationQueryPort,
  ) {}

  async findBlockingRooms(
    roomIds: string[],
    startDate: string,
    endDate: string,
    excludeReservationRef?: string,
  ): Promise<BlockingRoom[]> {
    // Sin habitaciones no hay nada que buscar: no se consulta la base.
    if (roomIds.length === 0) {
      return [];
    }
    return this.query.findBlockingRooms(
      roomIds,
      startDate,
      endDate,
      excludeReservationRef,
    );
  }
}
