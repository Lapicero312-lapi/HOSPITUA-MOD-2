import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_STAY_DATES,
  RESERVATION_NOT_FOUND,
} from '../../../domain/shared/error-codes.js';
import type { Room } from '../../integration/room.js';
import { mapWithLimit } from '../../shared/map-with-limit.js';
import {
  RESERVATION_LOOKUP,
  type ReservationLookup,
} from '../check-view-reservation/ports/in/reservation-lookup.port.js';
import {
  CONSULT_MAINTENANCE_CALENDAR,
  type ConsultMaintenanceCalendar,
} from '../consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from '../consult-room-inventory/ports/in/consult-room-inventory.port.js';
import { MAINTENANCE_CONCURRENCY } from '../../shared/maintenance-concurrency.js';
import {
  hasExactlyCategoryOrRoomId,
  isValidExcludeReservationRef,
  isValidStayDates,
} from './availability-query.validator.js';
import { INVALID_AVAILABILITY_QUERY } from './error-codes.js';
import type {
  AvailabilityQuery,
  AvailabilityResult,
  RoomAvailability,
  VerifyAvailability,
} from './ports/in/verify-availability.port.js';

/** El orden de `roomNumber`: los dígitos cuentan como número, así que la 201 va antes que la 1001. */
const ROOM_NUMBER_ORDER = new Intl.Collator('en', { numeric: true });

/**
 * `VerifyAvailability` (plan, B1 y D1): pide el inventario, cruza las habitaciones con las reservas que
 * ya ocupan inventario y consulta los mantenimientos solo de las que pasaron el cruce, en paralelo con el
 * tope `MAINTENANCE_CONCURRENCY`. No asume disponibilidad: si falla la consulta de una sola habitación,
 * falla toda la verificación.
 */
@Injectable()
export class VerifyAvailabilityService implements VerifyAvailability {
  constructor(
    @Inject(CONSULT_ROOM_INVENTORY)
    private readonly inventory: ConsultRoomInventory,
    @Inject(RESERVATION_LOOKUP)
    private readonly reservations: ReservationLookup,
    @Inject(CONSULT_MAINTENANCE_CALENDAR)
    private readonly maintenances: ConsultMaintenanceCalendar,
    @Inject(MAINTENANCE_CONCURRENCY)
    private readonly concurrency: number,
  ) {}

  async check(query: AvailabilityQuery): Promise<AvailabilityResult> {
    validate(query);
    await this.requireExistingReservation(query.excludeReservationRef);
    const { startDate, endDate } = query;
    const rooms = await this.roomsOf(query);
    const blocked = new Set(
      (
        await this.reservations.findBlockingRooms(
          rooms.map((room) => room.id),
          startDate,
          endDate,
          query.excludeReservationRef,
        )
      ).map(({ roomId }) => roomId),
    );
    // Las que ya están reservadas no se consultan en el calendario: su motivo es RESERVED. Las demás, de
    // menor a mayor número, para que con `limit` las primeras disponibles sean las que elegiría
    // `assignRooms` (plan, punto 5).
    const candidates = rooms
      .filter((room) => !blocked.has(room.id))
      .sort(byRoomNumber);
    let availableCount = 0;
    const checks = await mapWithLimit(
      candidates,
      this.concurrency,
      async (room) => {
        const check = await this.maintenances.check(
          room.id,
          startDate,
          endDate,
        );
        if (check.available) {
          availableCount++;
        }
        return check;
      },
      () => query.limit !== undefined && availableCount >= query.limit,
    );
    const maintenanceOf = new Map(
      checks.map((check, index) => [candidates[index].id, check]),
    );

    return {
      startDate,
      endDate,
      // Sin las que no se llegaron a consultar por `limit`: de ellas no se sabe si están disponibles.
      rooms: rooms
        .filter((room) => blocked.has(room.id) || maintenanceOf.has(room.id))
        .map((room): RoomAvailability => {
          const check = maintenanceOf.get(room.id);
          if (check === undefined) {
            return {
              room,
              available: false,
              reason: 'RESERVED',
              maintenance: [],
            };
          }
          if (!check.available) {
            return {
              room,
              available: false,
              reason: 'MAINTENANCE',
              maintenance: check.conflicts.map(
                ({ overlapStart, overlapEnd }) => ({
                  overlapStart,
                  overlapEnd,
                }),
              ),
            };
          }
          return { room, available: true, reason: null, maintenance: [] };
        })
        .sort((a, b) => byRoomNumber(a.room, b.room)),
    };
  }

  /**
   * La reserva que se modifica tiene que existir (plan, punto 7 y tabla de errores): si no, 400
   * `RESERVATION_NOT_FOUND`, antes de consultar el inventario. Sin `excludeReservationRef`, no hay nada que
   * revisar.
   */
  private async requireExistingReservation(
    excludeReservationRef: string | undefined,
  ): Promise<void> {
    if (excludeReservationRef === undefined) {
      return;
    }
    if ((await this.reservations.findByRef(excludeReservationRef)) === null) {
      throw new BusinessError(
        RESERVATION_NOT_FOUND.code,
        RESERVATION_NOT_FOUND.message,
      );
    }
  }

  /** Por categoría, todas sus habitaciones; por `roomId`, esa sola (`INVALID_ROOM_ID` si no existe). */
  private async roomsOf(query: AvailabilityQuery): Promise<Room[]> {
    return query.roomId !== undefined
      ? [await this.inventory.byRoomId(query.roomId)]
      : this.inventory.byCategory(query.categoryRoom ?? '');
  }
}

function byRoomNumber(a: Room, b: Room): number {
  return ROOM_NUMBER_ORDER.compare(a.roomNumber, b.roomNumber);
}

/** Las validaciones de D1, antes de consultar a nadie: las fechas, la categoría o la habitación, y la reserva que se modifica. */
function validate(query: AvailabilityQuery): void {
  // Lo pasa un flujo de reserva, no la Recepcionista: un `limit` inválido es un error del programa.
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit < 1)
  ) {
    throw new Error(
      `limit debe ser un entero mayor que 0 (llegó ${query.limit}).`,
    );
  }
  if (!isValidStayDates(query.startDate, query.endDate)) {
    throw new BusinessError(
      INVALID_STAY_DATES.code,
      INVALID_STAY_DATES.message,
    );
  }
  if (!hasExactlyCategoryOrRoomId(query.categoryRoom, query.roomId)) {
    throw new BusinessError(
      INVALID_AVAILABILITY_QUERY.code,
      INVALID_AVAILABILITY_QUERY.message,
    );
  }
  if (!isValidExcludeReservationRef(query.excludeReservationRef)) {
    throw new BusinessError(
      RESERVATION_NOT_FOUND.code,
      RESERVATION_NOT_FOUND.message,
    );
  }
}
