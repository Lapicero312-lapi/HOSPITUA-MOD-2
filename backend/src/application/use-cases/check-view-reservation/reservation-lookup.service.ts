import { Inject, Injectable } from '@nestjs/common';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import {
  RESERVATION_QUERY_PORT,
  type ReservationQueryPort,
} from '../../ports/out/reservation-query.port.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import type {
  BlockingRoom,
  NightBlockingRooms,
  ReservationLookup,
} from './ports/in/reservation-lookup.port.js';

/**
 * `ReservationLookup` (plan, "`ReservationLookup.findBlockingRooms`"): delega cada búsqueda en el puerto de
 * lectura `ReservationQueryPort`, y `findByRef` y `findForUpdate` en `ReservationRepository`, que devuelve
 * la reserva completa.
 */
@Injectable()
export class ReservationLookupService implements ReservationLookup {
  constructor(
    @Inject(RESERVATION_QUERY_PORT)
    private readonly query: ReservationQueryPort,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
  ) {}

  findByRef(reservationRef: string): Promise<Reservation | null> {
    return this.reservations.findByRef(reservationRef);
  }

  findForUpdate(
    tx: Transaction,
    reservationRef: string,
  ): Promise<Reservation | null> {
    return this.reservations.lockByRef(reservationRef, tx);
  }

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

  async blockingRoomsByCategory(
    categoryRoom: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<NightBlockingRooms[]> {
    // Un rango sin noches no tiene nada que buscar: no se consulta la base. Las fechas AAAA-MM-DD se
    // ordenan igual como texto.
    if (dateFrom >= dateTo) {
      return [];
    }
    return this.query.blockingRoomsByCategory(categoryRoom, dateFrom, dateTo);
  }
}
