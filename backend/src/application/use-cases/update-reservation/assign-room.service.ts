import { Inject, Injectable } from '@nestjs/common';
import type { Reservation } from '../../../domain/reservation/reservation.js';
import type { ReservationRoom } from '../../../domain/reservation/reservation-room.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type { ConflictReason } from '../../../domain/shared/enums.js';
import {
  CONCURRENT_UPDATE,
  GUEST_COUNT_EXCEEDS_CAPACITY,
  INVALID_ROOM_ID,
  RESERVATION_NOT_FOUND,
  ROOM_ALREADY_IN_RESERVATION,
  ROOM_NOT_AVAILABLE,
} from '../../../domain/shared/error-codes.js';
import type { Room } from '../../integration/room.js';
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
import { mapWithLimit } from '../../shared/map-with-limit.js';
import { isSameInstant } from '../cancel-reservation/same-instant.js';
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
import { isValidRoomId } from '../consult-room-inventory/room-id.validator.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from '../consult-room-inventory/ports/in/consult-room-inventory.port.js';
import {
  CATEGORY_MISMATCH,
  RESERVATION_NOT_IN_CONFLICT,
  ROOM_ALREADY_ASSIGNED,
  STATUS_NOT_EDITABLE,
} from './error-codes.js';
import type { AssignRoom } from './ports/in/assign-room.port.js';

/** Lo que cabe en una reserva (FR-005): de 1 a 10 habitaciones. */
const MAX_ASSIGNMENTS = 10;

/** Una asignación pedida, ya con su forma revisada. */
type Assignment = { reservationRoomId: string; roomId: string };

/** Una asignación con su habitación sin asignar y la habitación elegida del Módulo 1. */
type CheckedAssignment = { target: ReservationRoom; room: Room };

/** Cómo terminó una consulta: con su resultado o con su error. */
type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * `AssignRoom` (plan de `update-reservation`, B3 y punto 16; FR-025; T027). Las consultas al Módulo 1 van
 * antes de abrir la transacción (regla 6 del plan base); dentro se vuelve a comparar `updatedAt`.
 */
@Injectable()
export class AssignRoomService implements AssignRoom {
  constructor(
    @Inject(RESERVATION_LOOKUP)
    private readonly lookup: ReservationLookup,
    @Inject(CONSULT_ROOM_INVENTORY)
    private readonly inventory: ConsultRoomInventory,
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly ariChanges: AriChangeRecorder,
    @Inject(GET_RESERVATION_DETAIL)
    private readonly detail: GetReservationDetail,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(MAINTENANCE_CONCURRENCY)
    private readonly concurrency: number,
  ) {}

  async execute(
    reservationRef: string,
    body: unknown,
  ): Promise<ReservationDetail> {
    // Paso 1: la forma.
    const { expectedUpdatedAt, assignments } = readAssignments(body);

    // Paso 2: una reserva de Booking en conflicto, que todavía admite cambios (ni cancelada ni No-Show).
    const reservation = await this.lookup.findByRef(reservationRef);
    if (reservation === null) {
      throw errorOf(RESERVATION_NOT_FOUND);
    }
    if (reservation.source !== 'OTA' || reservation.conflict === null) {
      throw errorOf(RESERVATION_NOT_IN_CONFLICT);
    }
    if (reservation.status !== 'ACTIVE' && reservation.status !== 'PENDING') {
      throw errorOf(STATUS_NOT_EDITABLE);
    }

    // Paso 3: nadie la cambió desde que la pantalla la leyó.
    checkUpdatedAt(expectedUpdatedAt, reservation);

    // Paso 4: cada habitación de la reserva es suya y está sin asignar.
    const targets = assignments.map(({ reservationRoomId }) => {
      const target = reservation.rooms.find(
        ({ id }) => id === reservationRoomId,
      );
      if (target === undefined || target.roomId !== null) {
        throw errorOf(ROOM_ALREADY_ASSIGNED);
      }
      return target;
    });

    // Pasos 5 y 6: la categoría, la capacidad y la disponibilidad de cada habitación elegida.
    const checked = await this.checkRooms(reservation, assignments, targets);

    // Paso 7: el conflicto que queda.
    const conflictReason = await this.remainingConflict(reservation, checked);

    await this.save(expectedUpdatedAt, reservation, checked, conflictReason);
    return this.detail.execute(reservation.reservationRef);
  }

  /** Pasos 5 y 6, en el orden de la solicitud: el primero que falla responde. */
  private async checkRooms(
    reservation: Reservation,
    assignments: readonly Assignment[],
    targets: readonly ReservationRoom[],
  ): Promise<CheckedAssignment[]> {
    const rooms = await this.settle(assignments, ({ roomId }) =>
      this.inventory.byRoomId(roomId),
    );
    const checked = assignments.map((_, index): CheckedAssignment => {
      const room = valueOf(rooms[index]);
      const target = targets[index];
      if (room.categoryRoom !== target.categoryRoom) {
        throw errorOf(CATEGORY_MISMATCH);
      }
      if (room.maxCapacity < target.guestCount) {
        throw errorOf(GUEST_COUNT_EXCEEDS_CAPACITY);
      }
      return { target, room };
    });
    const results = await this.settle(checked, ({ room }) =>
      this.availability.check({
        roomId: room.id,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        excludeReservationRef: reservation.reservationRef,
      }),
    );
    checked.forEach(({ room }, index) => {
      const [checkedRoom] = valueOf(results[index]).rooms;
      if (checkedRoom === undefined || !checkedRoom.available) {
        throw roomNotAvailable(room.roomNumber);
      }
    });
    return checked;
  }

  /**
   * Paso 7: si aún queda alguna sin asignar, `NO_ROOM_AVAILABLE`; si el motivo era `CHANGE_NOT_APPLICABLE`,
   * se conserva; si no, `CAPACITY_EXCEEDED` si alguna de las demás asignadas tiene menos capacidad que sus
   * personas; si no, ninguno.
   */
  private async remainingConflict(
    reservation: Reservation,
    checked: readonly CheckedAssignment[],
  ): Promise<ConflictReason | null> {
    const assignedNow = new Set(checked.map(({ target }) => target.id));
    const others = reservation.rooms.filter(({ id }) => !assignedNow.has(id));
    if (others.some(({ roomId }) => roomId === null)) {
      return 'NO_ROOM_AVAILABLE';
    }
    if (reservation.conflict?.reason === 'CHANGE_NOT_APPLICABLE') {
      return 'CHANGE_NOT_APPLICABLE';
    }
    const capacities = await this.settle(others, ({ roomId }) =>
      this.inventory.byRoomId(roomId as string),
    );
    const exceeded = others.some(
      ({ guestCount }, index) =>
        valueOf(capacities[index]).maxCapacity < guestCount,
    );
    return exceeded ? 'CAPACITY_EXCEEDED' : null;
  }

  /** La transacción: bloquea, vuelve a comparar `updatedAt`, guarda y avisa. */
  private async save(
    expectedUpdatedAt: string | undefined,
    reservation: Reservation,
    checked: readonly CheckedAssignment[],
    conflictReason: ConflictReason | null,
  ): Promise<void> {
    try {
      await this.transactions.run(async (tx) => {
        const locked = await this.lookup.findForUpdate(
          tx,
          reservation.reservationRef,
        );
        if (locked === null) {
          throw errorOf(RESERVATION_NOT_FOUND);
        }
        checkUpdatedAt(expectedUpdatedAt, locked);
        const saved = await this.reservations.update(
          locked.withAssignedRooms({
            rooms: checked.map(({ target, room }) => ({
              reservationRoomId: target.id,
              roomId: room.id,
              roomNumber: room.roomNumber,
            })),
            conflictReason,
            changedAt: this.clock.now(),
          }),
          tx,
        );
        await this.dailyList.record(tx, locked, saved);
        await this.ariChanges.record(
          tx,
          [...new Set(checked.map(({ room }) => room.categoryRoom))].map(
            (categoryRoom) => ({
              categoryRoom,
              dateFrom: saved.startDate,
              dateTo: saved.endDate,
            }),
          ),
        );
      });
    } catch (error) {
      if (error instanceof RoomOverlapError) {
        throw await this.overlappedRoom(reservation, checked);
      }
      throw error;
    }
  }

  /** La primera elegida que ahora ocupa otra reserva; si ya no hay ninguna, la primera elegida. */
  private async overlappedRoom(
    reservation: Reservation,
    checked: readonly CheckedAssignment[],
  ): Promise<BusinessError> {
    const blocking = new Set(
      (
        await this.lookup.findBlockingRooms(
          checked.map(({ room }) => room.id),
          reservation.startDate,
          reservation.endDate,
          reservation.reservationRef,
        )
      ).map(({ roomId }) => roomId),
    );
    const [first] = checked;
    const chosen = checked.find(({ room }) => blocking.has(room.id)) ?? first;
    return roomNotAvailable(chosen.room.roomNumber);
  }

  /** Como `mapWithLimit`, pero espera todas: si fallan varias, responde la primera en orden. */
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
 * Paso 1: `assignments` es una lista de 1 a 10, cada una con un `reservationRoomId` y un `roomId` que son
 * UUID (quedan en minúsculas); si no, `INVALID_ROOM_ID`. Una repetida, `ROOM_ALREADY_IN_RESERVATION`.
 */
function readAssignments(body: unknown): {
  expectedUpdatedAt: string | undefined;
  assignments: Assignment[];
} {
  const fields =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const { updatedAt, assignments } = fields;
  if (
    !Array.isArray(assignments) ||
    assignments.length < 1 ||
    assignments.length > MAX_ASSIGNMENTS
  ) {
    throw errorOf(INVALID_ROOM_ID);
  }
  const read = assignments.map((entry: unknown): Assignment => {
    const { reservationRoomId, roomId } =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)
        : {};
    if (
      typeof reservationRoomId !== 'string' ||
      typeof roomId !== 'string' ||
      !isValidRoomId(reservationRoomId) ||
      !isValidRoomId(roomId)
    ) {
      throw errorOf(INVALID_ROOM_ID);
    }
    return {
      reservationRoomId: reservationRoomId.toLowerCase(),
      roomId: roomId.toLowerCase(),
    };
  });
  const repeated = (values: string[]) => new Set(values).size !== values.length;
  if (
    repeated(read.map(({ roomId }) => roomId)) ||
    repeated(read.map(({ reservationRoomId }) => reservationRoomId))
  ) {
    throw errorOf(ROOM_ALREADY_IN_RESERVATION);
  }
  return {
    expectedUpdatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
    assignments: read,
  };
}

function checkUpdatedAt(
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

function roomNotAvailable(roomNumber: string): BusinessError {
  return new BusinessError(
    ROOM_NOT_AVAILABLE.code,
    ROOM_NOT_AVAILABLE.message(roomNumber),
  );
}

function valueOf<R>(settled: Settled<R> | undefined): R {
  if (settled === undefined) {
    throw new Error('Falta el resultado de una consulta.');
  }
  if (!settled.ok) {
    throw settled.error;
  }
  return settled.value;
}

function errorOf(error: { code: string; message: string }): BusinessError {
  return new BusinessError(error.code, error.message);
}
