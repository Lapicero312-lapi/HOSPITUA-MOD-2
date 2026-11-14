import { Inject, Injectable } from '@nestjs/common';
import type {
  ModifiedRoomInput,
  Reservation,
} from '../../../domain/reservation/reservation.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { RESERVATION_NOT_FOUND } from '../../../domain/shared/error-codes.js';
import { Money } from '../../../domain/shared/money.js';
import type { RoomQuote } from '../../integration/room-quote.js';
import type { AriChange } from '../../ports/out/ari-pending-change.repository.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
  RoomOverlapError,
} from '../../ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
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
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  GET_RESERVATION_DETAIL,
  type GetReservationDetail,
  type ReservationDetail,
} from '../check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from '../configure-ota/ports/in/ari-change-recorder.port.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from '../consult-room-inventory/ports/in/consult-room-inventory.port.js';
import {
  type ModificationRequest,
  readExpectedRates,
  readModificationRequest,
} from './modification-request.validator.js';
import {
  changesOf,
  type CheckedModification,
  checkUpdatedAt,
  isUnchanged,
  ModificationSteps,
  quoteRequests,
  rateOf,
  roomNotAvailable,
} from './modification-steps.js';
import type { ConfirmModification } from './ports/in/confirm-modification.port.js';

/**
 * `ConfirmModification` (plan de `update-reservation`, B2, D2 y regla 9; T010, T011 y T012). Los pasos 1 a 8
 * son los de la vista previa (`ModificationSteps`); después vuelve a cotizar con `verifyQuotes` y, con las
 * llamadas a los Módulos 1 y 3 ya hechas (regla 6 del plan base), guarda en una transacción con el aviso a
 * la lista del día. Nunca guarda un monto que envía el cliente.
 */
@Injectable()
export class ConfirmModificationService implements ConfirmModification {
  private readonly steps: ModificationSteps;

  constructor(
    @Inject(RESERVATION_LOOKUP)
    private readonly lookup: ReservationLookup,
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
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(GET_RESERVATION_DETAIL)
    private readonly detail: GetReservationDetail,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly ariChanges: AriChangeRecorder,
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
  ): Promise<ReservationDetail> {
    // Paso 1: la forma del cuerpo y de `expectedRates`, antes de consultar nada (reglas 7 y 9).
    const request = readModificationRequest(body);
    const expectedRates = readExpectedRates(body);

    // Pasos 2 a 8: los mismos de la vista previa.
    const checked = await this.steps.check(reservationRef, request, body);

    // Paso 9: se vuelve a cotizar lo que dicta `roomsNeedingQuote` y se compara con lo que vio el
    // solicitante (decisión D1). Sin nada que recotizar, no se llama al Módulo 3.
    const quotes =
      checked.toQuote.length === 0
        ? []
        : await this.rates.verifyQuotes(
            expectedRates.map(({ roomId, lodgingAmount, currency }) => ({
              key: roomId,
              lodgingAmount: Money.of(lodgingAmount, currency),
            })),
            quoteRequests(checked.toQuote, checked.startDate, checked.endDate),
            'RECALCULATION',
          );

    // Sin cambios no se guarda: no cambia el `updatedAt` ni se avisa al Módulo 1.
    if (isUnchanged(changesOf(checked))) {
      return this.detail.execute(checked.reservation.reservationRef);
    }

    // Paso 11: la transacción, con el aviso a la lista del día (T012).
    await this.save(request, checked, quotes);

    // La misma forma que C3, con el `updatedAt` nuevo (regla 6 del plan base).
    return this.detail.execute(checked.reservation.reservationRef);
  }

  /**
   * Bloquea la reserva, vuelve a comparar `updatedAt`, la guarda modificada y avisa a la lista del día, todo
   * en una transacción. Si la restricción anti-solape rechaza una habitación, la transacción ya se revirtió:
   * responde `ROOM_NOT_AVAILABLE` con la habitación que chocó.
   */
  private async save(
    request: ModificationRequest,
    checked: CheckedModification,
    quotes: readonly RoomQuote[],
  ): Promise<void> {
    const { reservationRef } = checked.reservation;
    try {
      await this.transactions.run(async (tx) => {
        const locked = await this.lookup.findForUpdate(tx, reservationRef);
        if (locked === null) {
          throw new BusinessError(
            RESERVATION_NOT_FOUND.code,
            RESERVATION_NOT_FOUND.message,
          );
        }
        // Lo que pasó entre la verificación y el bloqueo (otra confirmación, un Check-In, una cancelación)
        // cambió el `updatedAt`.
        checkUpdatedAt(request.expectedUpdatedAt, locked);
        const saved = await this.reservations.update(
          modified(locked, checked, quotes),
          tx,
        );
        await this.dailyList.record(tx, locked, saved);
        // Punto 17 (T028): lo que se libera y lo que se ocupa, para Channex.
        await this.ariChanges.record(tx, occupancyChanges(locked, saved));
      });
    } catch (error) {
      if (error instanceof RoomOverlapError) {
        throw await this.overlappedRoom(checked);
      }
      throw error;
    }
  }

  /**
   * La habitación que chocó con la restricción anti-solape: la primera verificada en el paso 8, en el orden
   * de la solicitud, que ahora ocupa otra reserva. Si ya no hay ninguna (la otra se canceló), la primera
   * verificada.
   */
  private async overlappedRoom(
    checked: CheckedModification,
  ): Promise<BusinessError> {
    const verified = checked.availability.map(({ room }) => room);
    const blocking = new Set(
      (
        await this.lookup.findBlockingRooms(
          verified.map(({ id }) => id),
          checked.startDate,
          checked.endDate,
          checked.reservation.reservationRef,
        )
      ).map(({ roomId }) => roomId),
    );
    const [first] = verified;
    const room = verified.find(({ id }) => blocking.has(id)) ?? first;
    if (room === undefined) {
      // Sin habitaciones verificadas no cambia ningún rango: la restricción no puede rechazarlo.
      throw new Error(
        `La reserva ${checked.reservation.reservationRef} chocó sin habitaciones verificadas.`,
      );
    }
    return roomNotAvailable(room.roomNumber);
  }
}

/**
 * Punto 17 (T028): cada categoría de antes en las fechas de antes (lo que se libera) y cada categoría de
 * después en las fechas nuevas (lo que se ocupa), sin repetir.
 */
function occupancyChanges(
  before: Reservation,
  after: Reservation,
): AriChange[] {
  const changes = new Map<string, AriChange>();
  for (const reservation of [before, after]) {
    for (const { categoryRoom } of reservation.rooms) {
      const change = {
        categoryRoom,
        dateFrom: reservation.startDate,
        dateTo: reservation.endDate,
      };
      changes.set(
        `${change.categoryRoom}|${change.dateFrom}|${change.dateTo}`,
        change,
      );
    }
  }
  return [...changes.values()];
}

/**
 * Paso 10 (T011): la reserva bloqueada con los cambios. Cada habitación, en el orden de la solicitud, con la
 * tarifa de `rateOf`: la cotización nueva, la heredada de la quitada o la suya.
 */
function modified(
  locked: Reservation,
  checked: CheckedModification,
  quotes: readonly RoomQuote[],
): Reservation {
  const keptRows = new Map(
    checked.diff.kept.map(({ current, requested }) => [requested, current.id]),
  );
  const rooms = checked.roomsAfter.map((room): ModifiedRoomInput => {
    const rate = rateOf(room, checked, quotes);
    if (rate === null) {
      // Una habitación de una reserva directa siempre tiene su tarifa.
      throw new Error(`La habitación ${room.roomId} no tiene tarifa.`);
    }
    return {
      keptRoomId: keptRows.get(room) ?? null,
      room: {
        roomId: room.roomId,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
      },
      guestCount: room.guestCount,
      rate: { roomGrossAmount: rate.amount, quoteId: rate.quoteId },
    };
  });
  return locked.withModification({
    startDate: checked.startDate,
    endDate: checked.endDate,
    rooms,
    guest: checked.guest,
    notes: checked.notes,
  });
}
