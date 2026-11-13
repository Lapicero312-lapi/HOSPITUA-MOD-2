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
import type { Clock } from '../../ports/out/clock.js';
import { mapWithLimit } from '../../shared/map-with-limit.js';
import { isSameInstant } from '../cancel-reservation/same-instant.js';
import type {
  RoomAvailability,
  VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import type { ReservationLookup } from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import type { ConsultRoomInventory } from '../consult-room-inventory/ports/in/consult-room-inventory.port.js';
import {
  OTA_RESERVATION_READ_ONLY,
  STATUS_NOT_EDITABLE,
} from './error-codes.js';
import {
  type HolderCorrection,
  type ModificationRequest,
  readHolderAndNotes,
  type RequestedRoom,
} from './modification-request.validator.js';
import type { ModificationChanges } from './ports/in/preview-modification.port.js';

/** Los estados que admiten una modificación (regla 1; FR-001). */
const EDITABLE_STATUSES = ['ACTIVE', 'PENDING'];

/**
 * Una habitación que quedaría en la reserva: su `roomId`, su número, su categoría y sus personas. El número
 * lo necesita la fila nueva de una agregada o una cambiada (regla 9).
 */
export type RoomAfter = {
  roomId: string;
  roomNumber: string;
  categoryRoom: string;
  guestCount: number;
};

/** Lo que dejan los pasos 2 a 8 de la regla 3: todo revisado y la disponibilidad verificada. */
export type CheckedModification = {
  reservation: Reservation;
  startDate: string;
  endDate: string;
  datesChanged: boolean;
  /** Las que quedarían, en el orden de la solicitud (o las actuales, si `rooms` no vino). */
  roomsAfter: RoomAfter[];
  diff: RoomsDiff<ReservationRoom, RoomAfter>;
  guest: HolderCorrection | undefined;
  notes: string | null | undefined;
  /** Las verificadas en el paso 8, en el orden de la solicitud. */
  availability: RoomAvailability[];
  /** Las que dicta `roomsNeedingQuote` (paso 9), en el orden de la solicitud. */
  toQuote: RoomAfter[];
};

/** Cómo terminó una consulta: con su resultado o con su error. */
type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Los pasos 2 a 8 de la regla 3 de la modificación, comunes a la vista previa (B1, regla 8) y a la
 * confirmación (B2, regla 9), para que las dos validen igual y respondan el mismo error. No guarda nada ni
 * abre una transacción. El paso 1 (la forma) lo hace cada servicio, porque la confirmación revisa además
 * `expectedRates`.
 */
export class ModificationSteps {
  constructor(
    private readonly lookup: ReservationLookup,
    private readonly inventory: ConsultRoomInventory,
    private readonly availability: VerifyAvailability,
    private readonly clock: Clock,
    private readonly concurrency: number,
  ) {}

  /**
   * @param request La forma del cuerpo, ya revisada (paso 1).
   * @param body El cuerpo tal como llegó, para el titular y las observaciones (paso 7).
   */
  async check(
    reservationRef: string,
    request: ModificationRequest,
    body: unknown,
  ): Promise<CheckedModification> {
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
    checkUpdatedAt(request.expectedUpdatedAt, reservation);

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

    const toQuote = roomsNeedingQuote(
      { startDate: reservation.startDate, endDate: reservation.endDate },
      { startDate, endDate, rooms: roomsAfter },
      diff,
    );
    return {
      reservation,
      startDate,
      endDate,
      datesChanged,
      roomsAfter,
      diff,
      guest,
      notes,
      availability,
      toQuote,
    };
  }

  /**
   * Pasos 5 y 6: la lista pedida, con el número, la categoría y la capacidad que da el Módulo 1 de cada
   * habitación. Las consultas van en paralelo con el tope `MAINTENANCE_CONCURRENCY` (NFR-001); si fallan
   * varias, responde la primera en el orden de la solicitud.
   */
  private async requestedRooms(
    rooms: readonly RequestedRoom[],
  ): Promise<RoomAfter[]> {
    checkRoomList(rooms.map(({ roomId }) => roomId));
    const found = await this.settle(rooms, ({ roomId }) =>
      this.inventory.byRoomId(roomId),
    );
    const withInventory = rooms.map(({ roomId, guestCount }, index) => {
      const { roomNumber, categoryRoom, maxCapacity } = valueOf(found[index]);
      return { roomId, roomNumber, categoryRoom, guestCount, maxCapacity };
    });
    checkGuestCounts(withInventory);
    return withInventory.map(
      ({ roomId, roomNumber, categoryRoom, guestCount }) => ({
        roomId,
        roomNumber,
        categoryRoom,
        guestCount,
      }),
    );
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
        throw roomNotAvailable(room.room.roomNumber);
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
}

/**
 * El paso 3, y también dentro de la transacción de la confirmación: el `updatedAt` enviado y el de la
 * reserva son el mismo instante (`isSameInstant`); si no, o si no vino, `CONCURRENT_UPDATE`.
 */
export function checkUpdatedAt(
  expectedUpdatedAt: string | undefined,
  reservation: Reservation,
): void {
  if (
    expectedUpdatedAt === undefined ||
    reservation.updatedAt === null ||
    !isSameInstant(expectedUpdatedAt, reservation.updatedAt)
  ) {
    throw errorOf(CONCURRENT_UPDATE);
  }
}

/** `ROOM_NOT_AVAILABLE` con el número de la habitación (tabla de errores de B). */
export function roomNotAvailable(roomNumber: string): BusinessError {
  return new BusinessError(
    ROOM_NOT_AVAILABLE.code,
    ROOM_NOT_AVAILABLE.message(roomNumber),
  );
}

/** Las solicitudes de cotización del paso 9: una por habitación, con `key` = su `roomId`. */
export function quoteRequests(
  toQuote: readonly RoomAfter[],
  startDate: string,
  endDate: string,
): RoomQuoteRequest[] {
  return toQuote.map(
    ({ roomId, categoryRoom }): RoomQuoteRequest => ({
      key: roomId,
      categoryRoom,
      startDate,
      endDate,
    }),
  );
}

/**
 * La tarifa de cada habitación que quedaría, en el orden de la regla 9: la cotización nueva si se
 * recotizó; si no, en una cambiada de la misma categoría, la de la quitada (la hereda); si no, en una
 * conservada, la suya. `null` si no tiene ninguna (no pasa en una reserva directa).
 */
export function rateOf(
  room: RoomAfter,
  checked: Pick<CheckedModification, 'diff'>,
  quotes: readonly RoomQuote[],
): { amount: Money; quoteId: string } | null {
  const quote = quotes.find(({ key }) => key === room.roomId);
  if (quote !== undefined) {
    return { amount: quote.lodgingAmount, quoteId: quote.quoteId };
  }
  const inherited = checked.diff.swappedSameCategory.find(
    ({ added }) => added === room,
  )?.removed;
  const kept = checked.diff.kept.find(
    ({ requested }) => requested === room,
  )?.current;
  const rate = (inherited ?? kept)?.rate;
  return rate === undefined || rate === null
    ? null
    : { amount: rate.roomGrossAmount, quoteId: rate.quoteId };
}

/** Paso 10 de la vista previa: la suma de las tarifas de todas las habitaciones que quedarían. */
export function totalOf(
  checked: Pick<CheckedModification, 'diff' | 'roomsAfter'>,
  quotes: readonly RoomQuote[],
): Money {
  const amounts = checked.roomsAfter.map((room) => {
    const rate = rateOf(room, checked, quotes);
    if (rate === null) {
      // Una habitación de una reserva directa siempre tiene su tarifa.
      throw new Error(`La habitación ${room.roomId} no tiene tarifa.`);
    }
    return rate.amount;
  });
  const [first, ...rest] = amounts;
  if (first === undefined) {
    throw new Error('La reserva quedaría sin habitaciones.');
  }
  return reservationTotal([first, ...rest]);
}

/** Qué cambia (B1), y si cambia algo (regla 9: sin cambios no se guarda). */
export function changesOf(checked: CheckedModification): ModificationChanges {
  const { reservation, diff, roomsAfter, guest, notes } = checked;
  const roomIdOf = (room: ReservationRoom): string => room.roomId ?? '';
  const guestCount = roomsAfter.reduce(
    (sum, room) => sum + room.guestCount,
    0,
  );
  return {
    dates: checked.datesChanged,
    roomsAdded: diff.added.map(({ roomId }) => roomId),
    roomsRemoved: diff.removed.map(roomIdOf),
    roomsSwapped: [...diff.swappedSameCategory, ...diff.swappedCategory].map(
      ({ removed, added }) => ({ from: roomIdOf(removed), to: added.roomId }),
    ),
    guestCountChanged:
      guestCount !== reservation.guestCount ||
      diff.kept.some(
        ({ current, requested }) => current.guestCount !== requested.guestCount,
      ),
    guestChanged: guest !== undefined && !sameHolder(reservation.guest, guest),
    notesChanged: notes !== undefined && notes !== reservation.notes,
  };
}

/** `true` si `changesOf` no encontró ningún cambio. */
export function isUnchanged(changes: ModificationChanges): boolean {
  return (
    !changes.dates &&
    changes.roomsAdded.length === 0 &&
    changes.roomsRemoved.length === 0 &&
    changes.roomsSwapped.length === 0 &&
    !changes.guestCountChanged &&
    !changes.guestChanged &&
    !changes.notesChanged
  );
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
    if (room.roomId === null || room.roomNumber === null) {
      // Una reserva directa siempre tiene sus habitaciones asignadas.
      throw new Error(
        `La reserva ${reservation.reservationRef} tiene una habitación sin asignar.`,
      );
    }
    return {
      roomId: room.roomId,
      roomNumber: room.roomNumber,
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

function errorOf(error: { code: string; message: string }): BusinessError {
  return new BusinessError(error.code, error.message);
}
