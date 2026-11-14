import { Inject, Injectable } from '@nestjs/common';
import { assignRooms } from '../../../domain/reservation/assign-rooms.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { CONCURRENT_UPDATE } from '../../../domain/shared/error-codes.js';
import type { AriChange } from '../../ports/out/ari-pending-change.repository.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import { isSameInstant } from '../cancel-reservation/same-instant.js';
import {
  type AvailabilityResult,
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from '../configure-ota/ports/in/ari-change-recorder.port.js';
import {
  REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
  type RegisterOtaConfirmationAndCommission,
} from '../register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import type {
  ApplyOtaChange,
  OtaChange,
  OtaChangePlan,
  PlannedOtaRoom,
} from './ports/in/apply-ota-change.port.js';

/** Los estados en los que Booking puede cambiar una reserva (B2 de `generate-ota-reservation`). */
const CHANGEABLE_STATUSES = ['ACTIVE', 'PENDING'];

/** El orden de los números de habitación: `99` antes que `100` (como `assignRooms`). */
const ROOM_NUMBER_ORDER = new Intl.Collator('en', { numeric: true });

/** Quien hace la auditoría de la comisión de un cambio de Booking (regla 6 de las comisiones). */
const BOOKING = 'Booking.com';

/**
 * `ApplyOtaChange` (plan de `update-reservation`, C4 y punto 15; FR-024; T026). `prepare` consulta y decide
 * sin escribir; `apply` solo escribe, en la transacción de `generate-ota-reservation`.
 */
@Injectable()
export class ApplyOtaChangeService implements ApplyOtaChange {
  constructor(
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(REGISTER_OTA_CONFIRMATION_AND_COMMISSION)
    private readonly commissions: RegisterOtaConfirmationAndCommission,
    @Inject(RESERVATION_LOOKUP)
    private readonly lookup: ReservationLookup,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly ariChanges: AriChangeRecorder,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async prepare(
    reservation: Reservation,
    change: OtaChange,
  ): Promise<OtaChangePlan> {
    // Paso 1: solo una reserva de Booking que todavía no empezó.
    if (
      reservation.source !== 'OTA' ||
      !CHANGEABLE_STATUSES.includes(reservation.status)
    ) {
      throw new Error(
        `La reserva ${reservation.reservationRef} no admite un cambio de Booking (${reservation.source}, ${reservation.status}).`,
      );
    }

    // Paso 2: la disponibilidad de cada categoría en las fechas nuevas, sin contar la propia reserva.
    const categories = [
      ...new Set(change.rooms.map(({ categoryRoom }) => categoryRoom)),
    ];
    const results = new Map<string, AvailabilityResult>();
    for (const categoryRoom of categories) {
      results.set(
        categoryRoom,
        await this.availability.check({
          categoryRoom,
          startDate: change.startDate,
          endDate: change.endDate,
          excludeReservationRef: reservation.reservationRef,
        }),
      );
    }

    // Paso 3: cada habitación del cambio, en su orden: se conserva, se reasigna o queda sin asignar.
    const used = new Set<string>();
    let capacityExceeded = false;
    const rooms = change.rooms.map(
      ({ categoryRoom, guestCount }): PlannedOtaRoom => {
        const result = results.get(categoryRoom);
        if (result === undefined) {
          throw new Error(`Falta la disponibilidad de ${categoryRoom}.`);
        }
        const free = new Map(
          result.rooms
            .filter(({ available }) => available)
            .map(({ room }) => [room.id, room]),
        );
        const kept = reservation.rooms
          .filter(
            (current) =>
              current.categoryRoom === categoryRoom &&
              current.roomId !== null &&
              !used.has(current.roomId) &&
              free.has(current.roomId),
          )
          .sort((a, b) =>
            ROOM_NUMBER_ORDER.compare(a.roomNumber ?? '', b.roomNumber ?? ''),
          )[0];
        if (kept !== undefined && kept.roomId !== null) {
          used.add(kept.roomId);
          const room = free.get(kept.roomId);
          capacityExceeded ||=
            room !== undefined && guestCount > room.maxCapacity;
          return {
            keptRoomId: kept.id,
            room: null,
            categoryRoom,
            guestCount,
          };
        }
        const [other] = assignRooms(result, 1, [...used]);
        if (other === undefined) {
          return { keptRoomId: null, room: null, categoryRoom, guestCount };
        }
        used.add(other.id);
        capacityExceeded ||= guestCount > other.maxCapacity;
        return {
          keptRoomId: null,
          room: { roomId: other.id, roomNumber: other.roomNumber },
          categoryRoom,
          guestCount,
        };
      },
    );

    // Paso 4: el conflicto, en el orden de `createOta`.
    const unassigned = rooms.some(
      ({ keptRoomId, room }) => keptRoomId === null && room === null,
    );
    const conflictReason = unassigned
      ? 'NO_ROOM_AVAILABLE'
      : capacityExceeded
        ? 'CAPACITY_EXCEEDED'
        : change.datesDifferPerRoom
          ? 'CHANGE_NOT_APPLICABLE'
          : null;

    // Paso 5: la comisión con el porcentaje congelado, solo si Booking cambió el valor.
    const before = reservation.ota?.grossAmount;
    const commission =
      before !== undefined && before.equals(change.grossAmount)
        ? null
        : this.commissions.recalculate(reservation, change.grossAmount);

    return { reservation, change, rooms, conflictReason, commission };
  }

  async apply(tx: Transaction, plan: OtaChangePlan): Promise<Reservation> {
    const { reservationRef, updatedAt } = plan.reservation;

    // Paso 1: nadie la cambió desde `prepare`.
    const locked = await this.lookup.findForUpdate(tx, reservationRef);
    if (
      locked === null ||
      locked.updatedAt === null ||
      updatedAt === null ||
      !isSameInstant(updatedAt, locked.updatedAt)
    ) {
      throw new BusinessError(
        CONCURRENT_UPDATE.code,
        CONCURRENT_UPDATE.message,
      );
    }

    // Pasos 2 y 3: la reserva cambiada, aplicada o en conflicto.
    const { change } = plan;
    const saved = await this.reservations.update(
      locked.withOtaChange({
        startDate: change.startDate,
        endDate: change.endDate,
        rooms: plan.rooms,
        notes: change.notes,
        guest: change.guest,
        grossAmount: change.grossAmount,
        commission: plan.commission,
        conflictReason: plan.conflictReason,
        changedAt: this.clock.now(),
      }),
      tx,
    );

    // Paso 4: la auditoría de la comisión recalculada.
    if (plan.commission !== null) {
      await this.commissions.recordAudit(
        tx,
        saved.id,
        plan.commission,
        BOOKING,
      );
    }

    // Pasos 5 y 6: los avisos a la lista del día y a Channex.
    await this.dailyList.record(tx, locked, saved);
    await this.ariChanges.record(tx, occupancyChanges(locked, saved));
    return saved;
  }
}

/**
 * Lo que se libera (cada categoría de antes en las fechas de antes) y lo que se ocupa (cada categoría de
 * después en las fechas nuevas), sin repetir (punto 15).
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
