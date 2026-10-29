import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type { Room } from '../../integration/room.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  CONSULT_MAINTENANCE_CALENDAR,
  type ConsultMaintenanceCalendar,
} from '../consult-maintenance-calendar/ports/in/consult-maintenance-calendar.port.js';
import {
  CONSULT_ROOM_INVENTORY,
  type ConsultRoomInventory,
} from './ports/in/consult-room-inventory.port.js';
import {
  type ListRoomsWithMaintenance,
  MAINTENANCE_CONCURRENCY,
  type RoomWithMaintenance,
} from './ports/in/list-rooms-with-maintenance.port.js';

/** Días de la ventana del mantenimiento próximo, contando hoy (plan, punto 4: "los siguientes 30 días"). */
const WINDOW_DAYS = 30;

/**
 * La pantalla "Habitaciones" (plan, D3): pide todas las habitaciones vendibles con una sola consulta y,
 * por cada una, su mantenimiento próximo, en paralelo y sin pasar del tope. Si falla el inventario, no
 * devuelve nada; si falla el calendario de una habitación, esa sale `UNAVAILABLE` y las demás siguen.
 */
@Injectable()
export class ListRoomsWithMaintenanceService implements ListRoomsWithMaintenance {
  private readonly logger = new Logger(ListRoomsWithMaintenanceService.name);

  constructor(
    @Inject(CONSULT_ROOM_INVENTORY)
    private readonly inventory: ConsultRoomInventory,
    @Inject(CONSULT_MAINTENANCE_CALENDAR)
    private readonly calendar: ConsultMaintenanceCalendar,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(MAINTENANCE_CONCURRENCY)
    private readonly concurrency: number,
  ) {}

  async execute(): Promise<RoomWithMaintenance[]> {
    const rooms = await this.inventory.listAll();
    const fromDate = this.clock.today();
    // `toDate` cuenta como la salida: la ventana va de hoy al día 29 después de hoy.
    const toDate = addDays(fromDate, WINDOW_DAYS);
    return mapWithLimit(rooms, this.concurrency, (room) =>
      this.withMaintenance(room, fromDate, toDate),
    );
  }

  /** La habitación con su mantenimiento próximo; si falla su calendario, `UNAVAILABLE`, sin romper la pantalla. */
  private async withMaintenance(
    room: Room,
    fromDate: string,
    toDate: string,
  ): Promise<RoomWithMaintenance> {
    try {
      const next = await this.calendar.nextMaintenance(
        room.id,
        fromDate,
        toDate,
      );
      if (next === null) {
        return {
          ...room,
          maintenance: {
            status: 'NONE',
            maintenanceStart: null,
            maintenanceEnd: null,
          },
        };
      }
      return {
        ...room,
        maintenance: {
          status: 'SCHEDULED',
          maintenanceStart: next.maintenanceStart,
          maintenanceEnd: next.maintenanceEnd,
        },
      };
    } catch (error) {
      this.logger.warn(
        `Mantenimiento próximo de la habitación ${room.id} no disponible: ${reasonOf(error)}`,
      );
      return {
        ...room,
        maintenance: {
          status: 'UNAVAILABLE',
          maintenanceStart: null,
          maintenanceEnd: null,
        },
      };
    }
  }
}

/** El código del `BusinessError`, o el tipo del error si no es uno: nunca su mensaje. */
function reasonOf(error: unknown): string {
  if (error instanceof BusinessError) {
    return error.errorCode;
  }
  return error instanceof Error ? error.constructor.name : typeof error;
}

/** `date` (`AAAA-MM-DD`) más `days` días; se calcula en UTC para que no dependa de la zona del computador. */
function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * Aplica `fn` a cada elemento con, como mucho, `limit` llamadas en curso a la vez, y devuelve los
 * resultados en el mismo orden de `items`.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
