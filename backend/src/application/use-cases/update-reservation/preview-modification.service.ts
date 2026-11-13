import { Inject, Injectable } from '@nestjs/common';
import type { Guest } from '../../../domain/guest/guest.js';
import {
  diffRooms,
  type RoomsDiff,
} from '../../../domain/reservation/diff-rooms.js';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import type { ReservationRoom } from '../../../domain/reservation/reservation-room.js';
import {
  checkGuestCounts,
  checkRoomList,
  checkStayDates,
} from '../../../domain/reservation/reservation-rules.js';
import { reservationTotal } from '../../../domain/reservation/reservation-total.js';
import { roomsNeedingQuote } from '../../../domain/reservation/rooms-needing-quote.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  CONCURRENT_UPDATE,
  RESERVATION_NOT_FOUND,
  ROOM_NOT_AVAILABLE,
} from '../../../domain/shared/error-codes.js';
import type { Money } from '../../../domain/shared/money.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../integration/room-quote.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import { MAINTENANCE_CONCURRENCY } from '../../shared/maintenance-concurrency.js';
import { mapWithLimit } from '../../shared/map-with-limit.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import { isSameInstant } from '../cancel-reservation/same-instant.js';
import {
  type RoomAvailability,
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
import {
  OTA_RESERVATION_READ_ONLY,
  STATUS_NOT_EDITABLE,
} from './error-codes.js';
import {
  type HolderCorrection,
  readHolderAndNotes,
  readModificationRequest,
  type RequestedRoom,
} from './modification-request.validator.js';
import type {
  ModificationChanges,
  ModificationPreview,
  ModificationQuotes,
  PreviewModification,
} from './ports/in/preview-modification.port.js';

/** Los estados que admiten una modificación (regla 1; FR-001). */
const EDITABLE_STATUSES = ['ACTIVE', 'PENDING'];

/** Una habitación que quedaría en la reserva: su `roomId`, su categoría y sus personas. */
type RoomAfter = { roomId: string; categoryRoom: string; guestCount: number };

/** Cómo terminó una consulta: con su resultado o con su error. */
type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * `PreviewModification` (plan de `update-reservation`, B1, D1 y regla 8; T009). Valida en el orden de la
 * regla 3, verifica la disponibilidad y cotiza lo que corresponda. No guarda nada ni abre una transacción.
 */
@Injectable()
export class PreviewModificationService implements PreviewModification {
  constructor(
    @Inject(RESERVATION_LOOKUP)
    private readonly lookup: ReservationLookup,
    @Inject(CONSULT_ROOM_INVENTORY)
    private readonly inventory: ConsultRoomInventory,
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(CALCULATE_DYNAMIC_RATE)
    private readonly rates: CalculateDynamicRate,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(MAINTENANCE_CONCURRENCY)
    private readonly concurrency: number,
  ) {}

  async execute(
    reservationRef: string,
    body: unknown,
  ): Promise<ModificationPreview> {
    // Paso 1: la forma del cuerpo, antes de consultar nada (regla 7).
    const request = readModificationRequest(body);

    // Paso 2: la reserva existe, es directa y su estado admite cambios.
    const reservation = await this.lookup.findByRef(reservationRef);
    if (reservation === null) {
      throw errorOf(RESERVATION_NOT_FOUND);
    }
    if (reservation.source === 'OTA') {
      throw errorOf(OTA_RESERVATION_READ_ONLY);
    }
    if (!EDITABLE_STATUSES.includes(reservation.status)) {
      throw errorOf(STATUS_NOT_EDITABLE);
    }

    // Paso 3: nadie la cambió desde que la pantalla la leyó (FR-008).
    if (
      request.expectedUpdatedAt === undefined ||
      reservation.updatedAt === null ||
      !isSameInstant(request.expectedUpdatedAt, reservation.updatedAt)
    ) {
      throw errorOf(CONCURRENT_UPDATE);
    }

    // Paso 4: las fechas que quedarían, aunque no cambien.
    const startDate = request.startDate ?? reservation.startDate;
    const endDate = request.endDate ?? reservation.endDate;
    checkStayDates(startDate, endDate, this.clock.today());

    // Pasos 5 y 6: sin `rooms`, quedan las actuales y no se consulta al Módulo 1.
    const roomsAfter =
      request.rooms === undefined
        ? currentRooms(reservation)
        : await this.requestedRooms(request.rooms);

    // Paso 7: el titular y las observaciones (regla 7).
    const { guest, notes } = readHolderAndNotes(body);

    // Paso 8: la disponibilidad de lo que cambia, sin contar la propia reserva.
    const diff = diffRooms(reservation.rooms, roomsAfter);
    const datesChanged =
      startDate !== reservation.startDate || endDate !== reservation.endDate;
    const availability = await this.verify(
      datesChanged ? roomsAfter : arriving(roomsAfter, diff),
      { startDate, endDate, excludeReservationRef: reservation.reservationRef },
    );

    // Pasos 9 y 10: la cotización de lo que dicta `roomsNeedingQuote` y el total de lo que quedaría.
    const toQuote = roomsNeedingQuote(
      { startDate: reservation.startDate, endDate: reservation.endDate },
      { startDate, endDate, rooms: roomsAfter },
      diff,
    );
    const quotes =
      toQuote.length === 0
        ? null
        : await this.quote(toQuote, roomsAfter, diff, startDate, endDate);

    const guestCount = sumOf(roomsAfter);
    return {
      reservationRef: reservation.reservationRef,
      changes: changesOf(reservation, diff, {
        datesChanged,
        guestCount,
        guest,
        notes,
      }),
      requiresConfirmation: quotes !== null,
      availability,
      quotes,
      reservation: { startDate, endDate, guestCount },
    };
  }

  /**
   * Pasos 5 y 6: la lista pedida, con la categoría y la capacidad que da el Módulo 1 de cada habitación.
   * Las consultas van en paralelo con el tope `MAINTENANCE_CONCURRENCY` (NFR-001); si fallan varias,
   * responde la primera en el orden de la solicitud.
   */
  private async requestedRooms(
    rooms: readonly RequestedRoom[],
  ): Promise<RoomAfter[]> {
    checkRoomList(rooms.map(({ roomId }) => roomId));
    const found = await this.settle(rooms, ({ roomId }) =>
      this.inventory.byRoomId(roomId),
    );
    const withInventory = rooms.map(({ roomId, guestCount }, index) => {
      const { categoryRoom, maxCapacity } = valueOf(found[index]);
      return { roomId, categoryRoom, guestCount, maxCapacity };
    });
    checkGuestCounts(withInventory);
    return withInventory.map(({ roomId, categoryRoom, guestCount }) => ({
      roomId,
      categoryRoom,
      guestCount,
    }));
  }

  /**
   * Paso 8: verifica las habitaciones en paralelo con el tope `MAINTENANCE_CONCURRENCY` (NFR-001) y, con
   * todas las respuestas, las recorre en el orden de la solicitud: la primera que falla, con un error o no
   * disponible, rechaza el cambio completo (FR-002).
   */
  private async verify(
    rooms: readonly RoomAfter[],
    stay: { startDate: string; endDate: string; excludeReservationRef: string },
  ): Promise<RoomAvailability[]> {
    const results = await this.settle(rooms, ({ roomId }) =>
      this.availability.check({ ...stay, roomId }),
    );
    const verified: RoomAvailability[] = [];
    for (const [index, { roomId }] of rooms.entries()) {
      const [room] = valueOf(results[index]).rooms;
      if (room === undefined) {
        throw new Error(
          `VerifyAvailability no devolvió la habitación ${roomId}.`,
        );
      }
      if (!room.available) {
        throw new BusinessError(
          ROOM_NOT_AVAILABLE.code,
          ROOM_NOT_AVAILABLE.message(room.room.roomNumber),
        );
      }
      verified.push(room);
    }
    return verified;
  }

  /**
   * Llama a `fn` con cada elemento, con como mucho `MAINTENANCE_CONCURRENCY` llamadas en curso, y espera
   * todas: un error no corta las demás, para que quien llama responda el de la primera en orden y no el
   * del que contestó antes.
   */
  private settle<T, R>(
    items: readonly T[],
    fn: (item: T) => Promise<R>,
  ): Promise<Settled<R>[]> {
    return mapWithLimit(items, this.concurrency, async (item) => {
      try {
        return { ok: true, value: await fn(item) } as const;
      } catch (error) {
        return { ok: false, error } as const;
      }
    });
  }

  /** Pasos 9 y 10: una cotización por habitación, todo o nada, y el total de todas las que quedarían. */
  private async quote(
    toQuote: readonly RoomAfter[],
    roomsAfter: readonly RoomAfter[],
    diff: RoomsDiff<ReservationRoom, RoomAfter>,
    startDate: string,
    endDate: string,
  ): Promise<ModificationQuotes> {
    const requests = toQuote.map(
      ({ roomId, categoryRoom }): RoomQuoteRequest => ({
        key: roomId,
        categoryRoom,
        startDate,
        endDate,
      }),
    );
    const quotes = await this.rates.quoteRooms(requests, 'RECALCULATION');
    return { quotes, requests, total: totalOf(roomsAfter, diff, quotes) };
  }
}

/** El resultado de una consulta, o su error si falló. */
function valueOf<R>(settled: Settled<R> | undefined): R {
  if (settled === undefined) {
    throw new Error('Falta el resultado de una consulta.');
  }
  if (!settled.ok) {
    throw settled.error;
  }
  return settled.value;
}

/** Las habitaciones actuales, tal como quedan si `rooms` no viene. */
function currentRooms(reservation: Reservation): RoomAfter[] {
  return reservation.rooms.map((room) => {
    if (room.roomId === null) {
      // Una reserva directa siempre tiene sus habitaciones asignadas.
      throw new Error(
        `La reserva ${reservation.reservationRef} tiene una habitación sin asignar.`,
      );
    }
    return {
      roomId: room.roomId,
      categoryRoom: room.categoryRoom,
      guestCount: room.guestCount,
    };
  });
}

/** Las agregadas y las nuevas de las cambiadas, de cualquier categoría, en el orden de la solicitud. */
function arriving(
  roomsAfter: readonly RoomAfter[],
  diff: RoomsDiff<ReservationRoom, RoomAfter>,
): RoomAfter[] {
  const arrivals = new Set<RoomAfter>([
    ...diff.added,
    ...diff.swappedSameCategory.map(({ added }) => added),
    ...diff.swappedCategory.map(({ added }) => added),
  ]);
  return roomsAfter.filter((room) => arrivals.has(room));
}

/**
 * Paso 10: el `lodgingAmount` nuevo de las recotizadas, la tarifa de la quitada en las cambiadas de la misma
 * categoría (la heredan) y la propia en las conservadas, sumados con `reservationTotal`.
 */
function totalOf(
  roomsAfter: readonly RoomAfter[],
  diff: RoomsDiff<ReservationRoom, RoomAfter>,
  quotes: readonly RoomQuote[],
): Money {
  const quoted = new Map(quotes.map((quote) => [quote.key, quote]));
  const kept = new Map(
    diff.kept.map(({ current, requested }) => [requested, current]),
  );
  const inherited = new Map(
    diff.swappedSameCategory.map(({ removed, added }) => [added, removed]),
  );
  const amounts = roomsAfter.map((room) => {
    const quote = quoted.get(room.roomId);
    if (quote !== undefined) {
      return quote.lodgingAmount;
    }
    const rate = (kept.get(room) ?? inherited.get(room))?.rate;
    if (rate === undefined || rate === null) {
      // Una habitación de una reserva directa siempre tiene su tarifa.
      throw new Error(`La habitación ${room.roomId} no tiene tarifa.`);
    }
    return rate.roomGrossAmount;
  });
  const [first, ...rest] = amounts;
  if (first === undefined) {
    throw new Error('La reserva quedaría sin habitaciones.');
  }
  return reservationTotal([first, ...rest]);
}

/** Qué cambia, para la pantalla (B1). */
function changesOf(
  reservation: Reservation,
  diff: RoomsDiff<ReservationRoom, RoomAfter>,
  after: {
    datesChanged: boolean;
    guestCount: number;
    guest: HolderCorrection | undefined;
    notes: string | null | undefined;
  },
): ModificationChanges {
  const roomIdOf = (room: ReservationRoom): string => room.roomId ?? '';
  return {
    dates: after.datesChanged,
    roomsAdded: diff.added.map(({ roomId }) => roomId),
    roomsRemoved: diff.removed.map(roomIdOf),
    roomsSwapped: [...diff.swappedSameCategory, ...diff.swappedCategory].map(
      ({ removed, added }) => ({ from: roomIdOf(removed), to: added.roomId }),
    ),
    guestCountChanged:
      after.guestCount !== reservation.guestCount ||
      diff.kept.some(
        ({ current, requested }) => current.guestCount !== requested.guestCount,
      ),
    guestChanged:
      after.guest !== undefined && !sameHolder(reservation.guest, after.guest),
    notesChanged:
      after.notes !== undefined && after.notes !== reservation.notes,
  };
}

/** Los seis datos que se corrigen (FR-001), sin la nacionalidad. */
function sameHolder(current: Guest, corrected: HolderCorrection): boolean {
  return (
    current.firstName === corrected.firstName &&
    current.lastName === corrected.lastName &&
    current.documentType === corrected.documentType &&
    current.documentNumber === corrected.documentNumber &&
    current.contactPhone === corrected.contactPhone &&
    current.contactEmail === corrected.contactEmail
  );
}

function sumOf(rooms: readonly RoomAfter[]): number {
  return rooms.reduce((sum, { guestCount }) => sum + guestCount, 0);
}

function errorOf(error: { code: string; message: string }): BusinessError {
  return new BusinessError(error.code, error.message);
}
