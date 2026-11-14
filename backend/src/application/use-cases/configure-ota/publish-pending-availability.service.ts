import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NightAvailability } from '../../../domain/ota/channex-grouping.js';
import { toChannexRanges } from '../../../domain/ota/channex-grouping.js';
import type { OtaRoomTypeMapping } from '../../../domain/ota/ota-room-type-mapping.js';
import {
  ARI_PENDING_CHANGE_REPOSITORY,
  type AriPendingChange,
  type AriPendingChangeRepository,
} from '../../ports/out/ari-pending-change.repository.js';
import {
  type AvailabilityRange,
  CHANNEX_PORT,
  type ChannexPort,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../ports/out/channex.port.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  OTA_ROOM_TYPE_MAPPING_REPOSITORY,
  type OtaRoomTypeMappingRepository,
} from '../../ports/out/ota-room-type-mapping.repository.js';
import { MAINTENANCE_CONCURRENCY } from '../../shared/maintenance-concurrency.js';
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
import {
  MANAGE_OTA,
  type ManageOta,
} from '../register-ota-information-commission/ports/in/manage-ota.port.js';
import {
  OTA_CONNECTION_TRACKER,
  type OtaConnectionTracker,
} from '../register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import {
  categoryAvailability,
  isModule1Unavailable,
  nextDay,
} from './category-availability.js';
import { BOOKING_OTA_NAME } from './ports/in/ensure-channex-setup.port.js';
import type {
  PendingAvailabilityResult,
  PublishPendingAvailability,
} from './ports/in/publish-pending-availability.port.js';

/** Las marcas de una categoría y sus noches por enviar (desde hoy). */
type CategoryMarks = { ids: string[]; nights: Set<string> };

/** Lo que salió de calcular una categoría. */
type CategoryOutcome =
  | { kind: 'SEND'; ranges: AvailabilityRange[] }
  | { kind: 'DISCARD' }
  | { kind: 'KEEP'; reason: string };

/**
 * `PublishPendingAvailability` (plan de `configure-ota`, B3, reglas 2, 3, 4 y 8, y D2; T010). Las consultas
 * van en orden de categoría; los mantenimientos de cada una, en paralelo con el tope `MAINTENANCE_CONCURRENCY`.
 */
@Injectable()
export class PublishPendingAvailabilityService implements PublishPendingAvailability {
  private readonly logger = new Logger(PublishPendingAvailabilityService.name);

  constructor(
    @Inject(ARI_PENDING_CHANGE_REPOSITORY)
    private readonly pending: AriPendingChangeRepository,
    @Inject(OTA_ROOM_TYPE_MAPPING_REPOSITORY)
    private readonly mappings: OtaRoomTypeMappingRepository,
    @Inject(CONSULT_ROOM_INVENTORY)
    private readonly inventory: ConsultRoomInventory,
    @Inject(RESERVATION_LOOKUP)
    private readonly lookup: ReservationLookup,
    @Inject(CONSULT_MAINTENANCE_CALENDAR)
    private readonly maintenance: ConsultMaintenanceCalendar,
    @Inject(MAINTENANCE_CONCURRENCY)
    private readonly concurrency: number,
    @Inject(CHANNEX_PORT)
    private readonly channex: ChannexPort,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(OTA_CONNECTION_TRACKER)
    private readonly connection: OtaConnectionTracker,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async publish(): Promise<PendingAvailabilityResult> {
    // Paso 1: las marcas.
    const marks = await this.pending.findAll();
    if (marks.length === 0) {
      return { status: 'NOTHING_PENDING' };
    }

    // Paso 2: por categoría, las noches marcadas desde hoy (FR-008).
    const byCategory = marksByCategory(marks, this.clock.today());
    // Paso 3: el tipo de Channex de cada categoría.
    const mappings = new Map(
      (await this.mappings.findAll()).map((mapping) => [
        mapping.categoryRoom,
        mapping,
      ]),
    );

    const values: AvailabilityRange[] = [];
    const sentIds: string[] = [];
    const sentCategories: string[] = [];
    const discardedIds: string[] = [];
    const kept: string[] = [];
    for (const categoryRoom of [...byCategory.keys()].sort()) {
      const entry = byCategory.get(categoryRoom) as CategoryMarks;
      const outcome = await this.categoryOutcome(
        categoryRoom,
        entry,
        mappings.get(categoryRoom) ?? null,
      );
      if (outcome.kind === 'DISCARD') {
        discardedIds.push(...entry.ids);
      } else if (outcome.kind === 'KEEP') {
        kept.push(outcome.reason);
      } else {
        values.push(...outcome.ranges);
        sentIds.push(...entry.ids);
        sentCategories.push(categoryRoom);
      }
    }

    if (discardedIds.length > 0) {
      await this.pending.deleteByIds(discardedIds);
    }
    if (values.length === 0) {
      return kept.length > 0
        ? { status: 'NOT_SENT', reason: kept[0] }
        : { status: 'SENT', categories: [], marks: discardedIds.length };
    }

    // Pasos 5 y 6: un solo A4 y su respuesta.
    const reason = await this.send(values, sentIds);
    if (reason !== null) {
      return { status: 'NOT_SENT', reason };
    }
    return {
      status: 'SENT',
      categories: sentCategories,
      marks: sentIds.length + discardedIds.length,
    };
  }

  /**
   * Pasos 2 a 4 para una categoría. Sin noches por enviar o sin tipo en Channex, sus marcas se borran; si el
   * Módulo 1 no responde (`INVENTORY_UNAVAILABLE` o `MAINTENANCE_CHECK_UNAVAILABLE`), se conservan para el
   * siguiente ciclo. Cualquier otro error sale tal cual y lo registra la tarea.
   */
  private async categoryOutcome(
    categoryRoom: string,
    entry: CategoryMarks,
    mapping: OtaRoomTypeMapping | null,
  ): Promise<CategoryOutcome> {
    if (entry.nights.size === 0) {
      return { kind: 'DISCARD' };
    }
    if (mapping === null) {
      this.logger.warn(
        `La categoría ${categoryRoom} todavía no tiene tipo de habitación en Channex: se descartan sus ${entry.ids.length} marcas. La disponibilidad completa sale con el envío diario cuando se cree el tipo.`,
      );
      return { kind: 'DISCARD' };
    }
    let nights: NightAvailability[];
    try {
      nights = await this.availabilityOf(
        categoryRoom,
        [...entry.nights].sort(),
        mapping.countOfRooms,
      );
    } catch (error) {
      if (isModule1Unavailable(error)) {
        this.logger.warn(
          `No se envía la disponibilidad de ${categoryRoom}: el Módulo 1 no respondió (${error.errorCode}). Sus marcas quedan para el siguiente ciclo.`,
        );
        return { kind: 'KEEP', reason: error.errorCode };
      }
      throw error;
    }
    return {
      kind: 'SEND',
      ranges: toChannexRanges(nights).map((range) => ({
        roomTypeId: mapping.channexRoomTypeId,
        ...range,
      })),
    };
  }

  /** Paso 4 (regla 2): el cálculo compartido con B4, de la primera a la última noche marcada. */
  private availabilityOf(
    categoryRoom: string,
    nights: string[],
    countOfRooms: number,
  ): Promise<NightAvailability[]> {
    return categoryAvailability(
      {
        inventory: this.inventory,
        lookup: this.lookup,
        maintenance: this.maintenance,
        concurrency: this.concurrency,
      },
      categoryRoom,
      nights,
      countOfRooms,
    );
  }

  /**
   * Pasos 5 y 6: el A4 y lo que se hace con cada respuesta de Channex (tabla de A). Devuelve el motivo si
   * Channex no lo aceptó, o `null` con el `200`.
   */
  private async send(
    values: AvailabilityRange[],
    sentIds: string[],
  ): Promise<string | null> {
    try {
      const { warnings } = await this.channex.pushAvailability(values);
      for (const warning of warnings) {
        this.logger.warn(
          `Channex aceptó la disponibilidad con un aviso: ${warning}`,
        );
      }
      await this.pending.deleteByIds(sentIds);
      return null;
    } catch (error) {
      if (error instanceof ChannexUnauthorizedError) {
        const at = this.clock.now();
        const { id } = await this.otas.register({ name: BOOKING_OTA_NAME }, at);
        await this.connection.markDisconnected(id, at);
        this.logger.warn(
          `${error.message} Al enviar la disponibilidad: la agencia pasa a DISCONNECTED y las marcas se conservan.`,
        );
        return `CHANNEX_${error.status}`;
      }
      if (error instanceof ChannexRejectedError) {
        // Un error permanente: se descarta para no repetirlo; el envío diario corrige (punto 3).
        this.logger.error(
          `Channex rechazó la disponibilidad (${error.status} ${error.code ?? 'sin código'}): se descartan las ${sentIds.length} marcas enviadas.`,
        );
        await this.pending.deleteByIds(sentIds);
        return `CHANNEX_${error.status}`;
      }
      if (
        error instanceof ChannexRateLimitedError ||
        error instanceof ChannexUnavailableError
      ) {
        this.logger.warn(
          `${error.message} Al enviar la disponibilidad: las marcas se conservan para el siguiente ciclo.`,
        );
        return error instanceof ChannexRateLimitedError
          ? 'CHANNEX_429'
          : 'CHANNEX_UNAVAILABLE';
      }
      throw error;
    }
  }
}

/** Paso 2: las marcas de cada categoría y la unión de sus noches `[dateFrom, dateTo)`, sin las anteriores a `today`. */
function marksByCategory(
  marks: readonly AriPendingChange[],
  today: string,
): Map<string, CategoryMarks> {
  const byCategory = new Map<string, CategoryMarks>();
  for (const { id, categoryRoom, dateFrom, dateTo } of marks) {
    const entry = byCategory.get(categoryRoom) ?? {
      ids: [],
      nights: new Set<string>(),
    };
    entry.ids.push(id);
    for (
      let day = dateFrom < today ? today : dateFrom;
      day < dateTo;
      day = nextDay(day)
    ) {
      entry.nights.add(day);
    }
    byCategory.set(categoryRoom, entry);
  }
  return byCategory;
}
