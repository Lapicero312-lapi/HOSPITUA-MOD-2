import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import { MAINTENANCE_CONCURRENCY } from '../../shared/maintenance-concurrency.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from '../consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { readModificationRequest } from './modification-request.validator.js';
import {
  changesOf,
  ModificationSteps,
  quoteRequests,
  totalOf,
} from './modification-steps.js';
import type {
  ModificationPreview,
  PreviewModification,
} from './ports/in/preview-modification.port.js';

/**
 * `PreviewModification` (plan de `update-reservation`, B1, D1 y regla 8; T009). Valida en el orden de la
 * regla 3, verifica la disponibilidad y cotiza lo que corresponda. No guarda nada ni abre una transacción.
 * Los pasos 2 a 8 son los de `ModificationSteps`, los mismos de la confirmación (regla 9).
 */
@Injectable()
export class PreviewModificationService implements PreviewModification {
  private readonly steps: ModificationSteps;

  constructor(
    @Inject(RESERVATION_LOOKUP)
    lookup: ReservationLookup,
    @Inject(CONSULT_ROOM_INVENTORY)
    inventory: ConsultRoomInventory,
    @Inject(VERIFY_AVAILABILITY)
    availability: VerifyAvailability,
    @Inject(CALCULATE_DYNAMIC_RATE)
    private readonly rates: CalculateDynamicRate,
    @Inject(CLOCK)
    clock: Clock,
    @Inject(MAINTENANCE_CONCURRENCY)
    concurrency: number,
  ) {
    this.steps = new ModificationSteps(
      lookup,
      inventory,
      availability,
      clock,
      concurrency,
    );
  }

  async execute(
    reservationRef: string,
    body: unknown,
  ): Promise<ModificationPreview> {
    // Paso 1: la forma del cuerpo, antes de consultar nada (regla 7).
    const request = readModificationRequest(body);

    // Pasos 2 a 8.
    const checked = await this.steps.check(reservationRef, request, body);
    const { reservation, startDate, endDate, roomsAfter, toQuote } = checked;

    // Pasos 9 y 10: la cotización de lo que dicta `roomsNeedingQuote` y el total de lo que quedaría.
    let quotes: ModificationPreview['quotes'] = null;
    if (toQuote.length > 0) {
      const requests = quoteRequests(toQuote, startDate, endDate);
      const quoted = await this.rates.quoteRooms(requests, 'RECALCULATION');
      quotes = {
        quotes: quoted,
        requests,
        total: totalOf(checked, quoted),
      };
    }

    return {
      reservationRef: reservation.reservationRef,
      changes: changesOf(checked),
      requiresConfirmation: quotes !== null,
      availability: checked.availability,
      quotes,
      reservation: {
        startDate,
        endDate,
        guestCount: roomsAfter.reduce((sum, room) => sum + room.guestCount, 0),
      },
    };
  }
}
