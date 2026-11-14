import { Inject, Injectable, Logger } from '@nestjs/common';
import { toChannexRanges } from '../../../domain/ota/channex-grouping.js';
import type { OtaRoomTypeMapping } from '../../../domain/ota/ota-room-type-mapping.js';
import {
  type AvailabilityRange,
  CHANNEX_PORT,
  type ChannexPort,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../ports/out/channex.port.js';
import {
  CHANNEX_SETUP_STATE,
  type ChannexSetupState,
} from '../../ports/out/channex-setup-state.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  OTA_ROOM_TYPE_MAPPING_REPOSITORY,
  type OtaRoomTypeMappingRepository,
} from '../../ports/out/ota-room-type-mapping.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
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
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from './ports/in/ari-change-recorder.port.js';
import { BOOKING_OTA_NAME } from './ports/in/ensure-channex-setup.port.js';
import type {
  DailyAvailabilityResult,
  PublishDailyAvailability,
} from './ports/in/publish-daily-availability.port.js';

/** Los días que se envían si la configuración de Channex no es válida (`CHANNEX_ARI_DAYS`, B0). */
const DEFAULT_ARI_DAYS = 90;

/**
 * `PublishDailyAvailability` (plan de `configure-ota`, B4, reglas 2, 3, 5 y 8; T011). Las categorías van en
 * orden alfabético; el cálculo de cada noche es el de B3 (`categoryAvailability`).
 */
@Injectable()
export class PublishDailyAvailabilityService implements PublishDailyAvailability {
  private readonly logger = new Logger(PublishDailyAvailabilityService.name);

  constructor(
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
    @Inject(CHANNEX_SETUP_STATE)
    private readonly setup: ChannexSetupState,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(OTA_CONNECTION_TRACKER)
    private readonly connection: OtaConnectionTracker,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly availabilityChanges: AriChangeRecorder,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async publish(): Promise<DailyAvailabilityResult> {
    // Paso 1: las categorías con tipo en Channex.
    const mappings = await this.sortedMappings();
    if (mappings.length === 0) {
      return { status: 'NOTHING_TO_SEND' };
    }
    // Paso 2: de hoy a hoy + CHANNEX_ARI_DAYS.
    const nights = this.nights();

    // Paso 3: la disponibilidad de cada noche, por categoría.
    const values: AvailabilityRange[] = [];
    const calculated: string[] = [];
    const unavailable: string[] = [];
    let reason: string | null = null;
    for (const mapping of mappings) {
      try {
        const availability = await categoryAvailability(
          {
            inventory: this.inventory,
            lookup: this.lookup,
            maintenance: this.maintenance,
            concurrency: this.concurrency,
          },
          mapping.categoryRoom,
          nights,
          mapping.countOfRooms,
        );
        values.push(
          ...toChannexRanges(availability).map((range) => ({
            roomTypeId: mapping.channexRoomTypeId,
            ...range,
          })),
        );
        calculated.push(mapping.categoryRoom);
      } catch (error) {
        if (!isModule1Unavailable(error)) {
          throw error;
        }
        this.logger.warn(
          `No se envía la disponibilidad completa de ${mapping.categoryRoom}: el Módulo 1 no respondió (${error.errorCode}). Sus noches quedan como marcas para el ciclo de 30 s.`,
        );
        unavailable.push(mapping.categoryRoom);
        reason ??= error.errorCode;
      }
    }
    if (unavailable.length > 0) {
      await this.markPending(unavailable);
    }
    if (values.length === 0) {
      return { status: 'NOT_SENT', reason: reason as string };
    }

    // Pasos 4 y 5: un solo A4 y su respuesta.
    const notSent = await this.send(values, calculated);
    return notSent === null
      ? { status: 'SENT', categories: calculated }
      : { status: 'NOT_SENT', reason: notSent };
  }

  async markAllPending(): Promise<void> {
    const mappings = await this.sortedMappings();
    if (mappings.length > 0) {
      await this.markPending(mappings.map(({ categoryRoom }) => categoryRoom));
    }
  }

  /**
   * Paso 5: el A4 y lo que se hace con cada respuesta de Channex (tabla de A). Devuelve el motivo si Channex
   * no lo aceptó, o `null` con el `200`.
   */
  private async send(
    values: AvailabilityRange[],
    categories: string[],
  ): Promise<string | null> {
    try {
      const { warnings } = await this.channex.pushAvailability(values);
      for (const warning of warnings) {
        this.logger.warn(
          `Channex aceptó la disponibilidad completa con un aviso: ${warning}`,
        );
      }
      return null;
    } catch (error) {
      if (error instanceof ChannexUnauthorizedError) {
        const at = this.clock.now();
        const { id } = await this.otas.register({ name: BOOKING_OTA_NAME }, at);
        await this.connection.markDisconnected(id, at);
        this.logger.warn(
          `${error.message} Al enviar la disponibilidad completa: la agencia pasa a DISCONNECTED.`,
        );
        return `CHANNEX_${error.status}`;
      }
      if (error instanceof ChannexRejectedError) {
        this.logger.error(
          `Channex rechazó la disponibilidad completa (${error.status} ${error.code ?? 'sin código'}): no se reintenta.`,
        );
        return `CHANNEX_${error.status}`;
      }
      if (
        error instanceof ChannexRateLimitedError ||
        error instanceof ChannexUnavailableError
      ) {
        this.logger.warn(
          `${error.message} Al enviar la disponibilidad completa: sus noches quedan como marcas para el ciclo de 30 s.`,
        );
        await this.markPending(categories);
        return error instanceof ChannexRateLimitedError
          ? 'CHANNEX_429'
          : 'CHANNEX_UNAVAILABLE';
      }
      throw error;
    }
  }

  /** Las noches de hoy a hoy + CHANNEX_ARI_DAYS de `categories`, como marcas de B2, en una transacción. */
  private async markPending(categories: string[]): Promise<void> {
    const dateFrom = this.clock.today();
    const dateTo = addDays(dateFrom, this.ariDays());
    await this.transactions.run((tx) =>
      this.availabilityChanges.record(
        tx,
        categories.map((categoryRoom) => ({ categoryRoom, dateFrom, dateTo })),
      ),
    );
  }

  private async sortedMappings(): Promise<OtaRoomTypeMapping[]> {
    return (await this.mappings.findAll()).sort((a, b) =>
      a.categoryRoom.localeCompare(b.categoryRoom),
    );
  }

  /** `[hoy, hoy + CHANNEX_ARI_DAYS)`, en orden. */
  private nights(): string[] {
    const nights: string[] = [];
    let day = this.clock.today();
    for (let i = 0; i < this.ariDays(); i += 1) {
      nights.push(day);
      day = nextDay(day);
    }
    return nights;
  }

  private ariDays(): number {
    return this.setup.settings()?.ariDays ?? DEFAULT_ARI_DAYS;
  }
}

/** `date` (`AAAA-MM-DD`) más `days` días, sin zona horaria. */
function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}
