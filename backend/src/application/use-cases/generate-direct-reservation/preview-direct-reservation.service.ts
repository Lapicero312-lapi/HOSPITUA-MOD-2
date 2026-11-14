import { Inject, Injectable } from '@nestjs/common';
import type { RoomQuoteRequest } from '../../integration/room-quote.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import { assignDirectRooms } from './assign-direct-rooms.js';
import { readPreviewRequest } from './direct-reservation-request.validator.js';
import type {
  DirectReservationPreview,
  PreviewDirectReservation,
} from './ports/in/preview-direct-reservation.port.js';

/**
 * La vista previa de una reserva directa (plan, A, D1 y punto 11). No guarda nada: revisa la solicitud,
 * verifica la disponibilidad de la categoría, asigna las habitaciones y las cotiza, una por una.
 */
@Injectable()
export class PreviewDirectReservationService implements PreviewDirectReservation {
  constructor(
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(CALCULATE_DYNAMIC_RATE)
    private readonly rates: CalculateDynamicRate,
  ) {}

  async execute(body: unknown): Promise<DirectReservationPreview> {
    // Regla 2, pasos 1 a 3: antes de consultar la disponibilidad o cotizar (FR-001a).
    const request = readPreviewRequest(body, this.clock.today());
    const { startDate, endDate, categoryRoom } = request;

    // Paso 5: todas las habitaciones de la categoría, sin `limit`, porque la pantalla las muestra.
    const availability = await this.availability.check({
      startDate,
      endDate,
      categoryRoom,
    });
    // Pasos 5 y 6: sin disponibilidad o sin capacidad, el Módulo 3 no recibe ninguna llamada (regla 3).
    const assignedRooms = assignDirectRooms(request.rooms, availability);

    // Paso 7: una cotización por habitación, aunque sean de la misma categoría; todo o nada.
    const quoteRequests = assignedRooms.map(
      ({ position }): RoomQuoteRequest => ({
        key: String(position),
        categoryRoom,
        startDate,
        endDate,
      }),
    );
    const quotes = await this.rates.quoteRooms(
      quoteRequests,
      'NEW_RESERVATION',
    );

    return {
      categoryRoom,
      availability,
      assignedRooms,
      quoteRequests,
      quotes,
      guestCount: request.rooms.reduce(
        (sum, { guestCount }) => sum + guestCount,
        0,
      ),
    };
  }
}
