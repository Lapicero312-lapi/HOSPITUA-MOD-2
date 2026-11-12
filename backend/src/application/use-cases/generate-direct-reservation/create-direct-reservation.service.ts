import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Guest } from '../../../domain/guest/guest.js';
import {
  type DirectRoomInput,
  Reservation,
} from '../../../domain/reservation/reservation.js';
import { Money } from '../../../domain/shared/money.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../integration/room-quote.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import {
  GET_RESERVATION_DETAIL,
  type GetReservationDetail,
  type ReservationDetail,
} from '../check-view-reservation/ports/in/get-reservation-detail.port.js';
import { assignDirectRooms } from './assign-direct-rooms.js';
import { readCreationRequest } from './direct-reservation-request.validator.js';
import type { CreateDirectReservation } from './ports/in/create-direct-reservation.port.js';
import type { AssignedRoom } from './ports/in/preview-direct-reservation.port.js';
import { withNewReservationRef } from './with-new-reservation-ref.js';

/**
 * La creación de una reserva directa (plan, B, D2 y punto 12; T008). Las llamadas a los Módulos 1 y 3 van
 * antes de abrir la transacción; dentro solo está la inserción (punto 5 de "Puntos que este plan
 * propone"). El reintento ante un solape (T009), los avisos a la lista del día y a Channex (T010) y la
 * `Idempotency-Key` (T019) los agregan sus tareas.
 */
@Injectable()
export class CreateDirectReservationService implements CreateDirectReservation {
  constructor(
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(CALCULATE_DYNAMIC_RATE)
    private readonly rates: CalculateDynamicRate,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(GET_RESERVATION_DETAIL)
    private readonly detail: GetReservationDetail,
  ) {}

  async execute(body: unknown): Promise<ReservationDetail> {
    // Paso 1: regla 2, pasos 1 a 4, antes de consultar la disponibilidad o cotizar (FR-001a).
    const request = readCreationRequest(body, this.clock.today());
    const { startDate, endDate, categoryRoom } = request;

    // Paso 2: una consulta nueva, con mantenimientos; no se reutiliza la de la vista previa (regla 9).
    const availability = await this.availability.check({
      startDate,
      endDate,
      categoryRoom,
    });
    const assignedRooms = assignDirectRooms(request.rooms, availability);

    // Paso 3: se vuelve a cotizar y se compara con lo que vio el solicitante (decisión D1).
    const quoteRequests = assignedRooms.map(
      ({ position }): RoomQuoteRequest => ({
        key: String(position),
        categoryRoom,
        startDate,
        endDate,
      }),
    );
    const quotes = await this.rates.verifyQuotes(
      request.expectedRates.map(({ position, lodgingAmount, currency }) => ({
        key: String(position),
        lodgingAmount: Money.of(lodgingAmount, currency),
      })),
      quoteRequests,
      'NEW_RESERVATION',
    );

    // Paso 4: un titular nuevo, propio de esta reserva (regla 6), y las cotizaciones nuevas.
    const guest = Guest.restore({ id: randomUUID(), ...request.guest });
    const rooms = roomsWithRates(assignedRooms, quotes);

    // Paso 5: una transacción por intento, porque un error de unicidad la deja abortada (regla 7).
    const saved = await withNewReservationRef((reservationRef) =>
      this.transactions.run((tx) =>
        this.reservations.insert(
          Reservation.createDirect({
            reservationRef,
            startDate,
            endDate,
            guest,
            notes: request.notes,
            rooms,
          }),
          tx,
        ),
      ),
    );

    // Paso 6: la misma forma que C3, con su `updatedAt`.
    return this.detail.execute(saved.reservationRef);
  }
}

/** Cada habitación asignada con la cotización nueva de su posición. */
function roomsWithRates(
  assignedRooms: readonly AssignedRoom[],
  quotes: readonly RoomQuote[],
): DirectRoomInput[] {
  const byKey = new Map(quotes.map((quote) => [quote.key, quote]));
  return assignedRooms.map(({ position, room, guestCount }) => {
    const quote = byKey.get(String(position));
    if (quote === undefined) {
      // `verifyQuotes` devuelve una por solicitud: si falta, es un error del programa.
      throw new Error(`Falta la cotización de la habitación ${position}.`);
    }
    return {
      room: {
        roomId: room.id,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        maxCapacity: room.maxCapacity,
      },
      guestCount,
      rate: { roomGrossAmount: quote.lodgingAmount, quoteId: quote.quoteId },
    };
  });
}
