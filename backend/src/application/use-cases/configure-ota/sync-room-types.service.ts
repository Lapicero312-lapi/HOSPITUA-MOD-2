import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  groupRoomsByCategory,
  type RoomTypeGroup,
} from '../../../domain/ota/channex-grouping.js';
import type { OtaRoomTypeMapping } from '../../../domain/ota/ota-room-type-mapping.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import type { Room } from '../../integration/room.js';
import {
  CHANNEX_PORT,
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
  type ChannexPort,
  type ChannexRoomType,
} from '../../ports/out/channex.port.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  OTA_ROOM_TYPE_MAPPING_REPOSITORY,
  type OtaRoomTypeMappingRepository,
} from '../../ports/out/ota-room-type-mapping.repository.js';
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
import { BOOKING_OTA_NAME } from './ports/in/ensure-channex-setup.port.js';
import type {
  RoomTypeSync,
  SyncRoomTypes,
} from './ports/in/sync-room-types.port.js';

/** Tope de Channex: tipos de habitación por propiedad, contando los que quedan sin habitaciones (C1, paso 5). */
export const MAX_ROOM_TYPES = 20;

/** Lo que pasó con una categoría: sigue con la siguiente o detiene la sincronización. */
type CategoryOutcome =
  { kind: 'CREATED' } | { kind: 'DONE' } | { kind: 'STOP'; reason: string };

/** Lo que pasó con un envío a Channex: se guardó, Channex lo rechazó (`4xx`) o hay que detenerse. */
type SendOutcome =
  { kind: 'SAVED' } | { kind: 'REJECTED' } | { kind: 'STOP'; reason: string };

/**
 * `SyncRoomTypes` (plan de `configure-ota`, C1 y "Cómo se arma (T007)"; FR-003, SC-001). Las llamadas a Channex
 * van de a una, en el orden alfabético de las categorías; la relación se guarda solo después del `200`, con lo
 * que se envió.
 */
@Injectable()
export class SyncRoomTypesService implements SyncRoomTypes {
  private readonly logger = new Logger(SyncRoomTypesService.name);

  constructor(
    @Inject(CONSULT_ROOM_INVENTORY)
    private readonly inventory: ConsultRoomInventory,
    @Inject(CHANNEX_PORT)
    private readonly channex: ChannexPort,
    @Inject(OTA_ROOM_TYPE_MAPPING_REPOSITORY)
    private readonly mappings: OtaRoomTypeMappingRepository,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(OTA_CONNECTION_TRACKER)
    private readonly connection: OtaConnectionTracker,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  async sync(): Promise<RoomTypeSync> {
    // Paso 1: las habitaciones vendibles del Módulo 1. Si no responde, no se toca Channex.
    let rooms: Room[];
    try {
      rooms = await this.inventory.listAll();
    } catch (error) {
      if (error instanceof BusinessError) {
        this.logger.warn(
          `No se sincronizan los tipos de habitación: el Módulo 1 no respondió (${error.errorCode}). Se intenta en la siguiente sincronización.`,
        );
        return { status: 'NOT_SYNCED', reason: error.errorCode };
      }
      throw error;
    }
    const groups = groupRoomsByCategory(rooms);

    // Paso 2: los tipos de la propiedad en Channex (A1) y las relaciones guardadas.
    let roomTypes: ChannexRoomType[];
    try {
      roomTypes = await this.channex.listRoomTypes();
    } catch (error) {
      return this.stopped(
        await this.channexFailure(error, 'leer los tipos de la propiedad'),
      );
    }
    const mappings = new Map(
      (await this.mappings.findAll()).map((mapping) => [
        mapping.categoryRoom,
        mapping,
      ]),
    );

    // Paso 4: las categorías con relación que ya no tienen habitaciones no se tocan.
    const sellable = new Set(groups.map(({ categoryRoom }) => categoryRoom));
    for (const mapping of mappings.values()) {
      if (!sellable.has(mapping.categoryRoom)) {
        this.logger.warn(
          `La categoría ${mapping.categoryRoom} ya no tiene habitaciones vendibles: su tipo ${mapping.channexRoomTypeId} se conserva con ${mapping.countOfRooms} habitaciones y disponibilidad 0. Revisar.`,
        );
      }
    }

    // Paso 3: cada categoría, en orden alfabético.
    const created: string[] = [];
    let typeCount = roomTypes.length;
    for (const group of groups) {
      const outcome = await this.syncCategory(
        group,
        mappings.get(group.categoryRoom) ?? null,
        roomTypes,
        typeCount,
      );
      if (outcome.kind === 'STOP') {
        return this.stopped(outcome.reason);
      }
      if (outcome.kind === 'CREATED') {
        created.push(group.categoryRoom);
        typeCount += 1;
      }
    }
    return { status: 'SYNCED', created };
  }

  /** El paso 3 para una categoría: crea, adopta, actualiza o no hace nada. */
  private async syncCategory(
    group: RoomTypeGroup,
    mapping: OtaRoomTypeMapping | null,
    roomTypes: readonly ChannexRoomType[],
    typeCount: number,
  ): Promise<CategoryOutcome> {
    const { categoryRoom } = group;
    const input = {
      title: categoryRoom,
      countOfRooms: group.countOfRooms,
      occupancy: group.occupancy,
    };

    const deleted =
      mapping !== null &&
      !roomTypes.some(({ id }) => id === mapping.channexRoomTypeId);
    if (deleted) {
      // Lo borraron a mano en Channex: se trata como sin relación, para no mandar A3 a un id que no existe.
      this.logger.warn(
        `El tipo de habitación ${mapping.channexRoomTypeId} de ${categoryRoom} ya no está en Channex: se adopta o se crea otro y la relación pasa a ese. Hay que volver a mapearlo a Booking.`,
      );
    }

    if (mapping !== null && !deleted) {
      // Con relación: solo si cambió la cantidad o la capacidad enviadas la última vez (A3).
      if (
        mapping.countOfRooms === group.countOfRooms &&
        mapping.occupancy === group.occupancy
      ) {
        return { kind: 'DONE' };
      }
      return categoryOutcome(
        await this.send(group, 'actualizar', async () => {
          await this.channex.updateRoomType(mapping.channexRoomTypeId, input);
          return mapping.channexRoomTypeId;
        }),
      );
    }

    const sameName = roomTypes.filter(({ title }) => title === categoryRoom);
    if (sameName.length > 0) {
      // Sin relación, con un tipo creado a mano: se adopta el primero enviándole lo del Módulo 1 (A3).
      const [adopted] = sameName;
      if (sameName.length > 1) {
        this.logger.warn(
          `Hay ${sameName.length} tipos de habitación llamados ${categoryRoom} en Channex: se usa el ${adopted.id}.`,
        );
      }
      return categoryOutcome(
        await this.send(group, 'adoptar', async () => {
          await this.channex.updateRoomType(adopted.id, input);
          return adopted.id;
        }),
      );
    }

    // Sin relación ni tipo: se crea (A2), si cabe en el tope de Channex (paso 5).
    if (typeCount >= MAX_ROOM_TYPES) {
      this.logger.error(
        `No se crea el tipo de habitación de ${categoryRoom}: la propiedad ya tiene ${typeCount} tipos, el tope de Channex. La categoría no se vende en Booking hasta que se libere un cupo.`,
      );
      return { kind: 'DONE' };
    }
    const sent = await this.send(
      group,
      'crear',
      async () => (await this.channex.createRoomType(input)).id,
    );
    return sent.kind === 'SAVED' ? { kind: 'CREATED' } : categoryOutcome(sent);
  }

  /**
   * Envía a Channex y, después del `200`, guarda la relación con lo enviado (nunca un valor leído de Channex).
   * Un `422` u otro `4xx` descarta solo esta categoría; lo demás detiene la sincronización.
   */
  private async send(
    group: RoomTypeGroup,
    action: string,
    call: () => Promise<string>,
  ): Promise<SendOutcome> {
    const { categoryRoom, countOfRooms, occupancy } = group;
    let channexRoomTypeId: string;
    try {
      channexRoomTypeId = await call();
    } catch (error) {
      if (error instanceof ChannexRejectedError) {
        this.logger.error(
          `Channex rechazó ${action} el tipo de habitación de ${categoryRoom} (${error.status} ${error.code ?? 'sin código'}): no se guarda y se intenta en la siguiente sincronización.`,
        );
        return { kind: 'REJECTED' };
      }
      return {
        kind: 'STOP',
        reason: await this.channexFailure(
          error,
          `${action} el tipo de ${categoryRoom}`,
        ),
      };
    }
    await this.mappings.upsert({
      channexRoomTypeId,
      categoryRoom,
      countOfRooms,
      occupancy,
    });
    this.logger.log(
      `Tipo de habitación de ${categoryRoom} al ${action}: ${channexRoomTypeId}, ${countOfRooms} habitaciones y capacidad ${occupancy}.`,
    );
    return { kind: 'SAVED' };
  }

  /** La respuesta de Channex que detiene la sincronización (tabla de A): el motivo, ya en el log. */
  private async channexFailure(error: unknown, doing: string): Promise<string> {
    if (error instanceof ChannexUnauthorizedError) {
      const at = this.clock.now();
      const { id } = await this.otas.register({ name: BOOKING_OTA_NAME }, at);
      await this.connection.markDisconnected(id, at);
      this.logger.warn(
        `${error.message} Al ${doing}: la agencia pasa a DISCONNECTED y se detiene la sincronización de tipos.`,
      );
      return `CHANNEX_${error.status}`;
    }
    if (
      error instanceof ChannexRateLimitedError ||
      error instanceof ChannexUnavailableError ||
      error instanceof ChannexRejectedError
    ) {
      // Un `4xx` llega aquí solo al leer los tipos (A1): sin la lista no se puede seguir.
      this.logger.warn(
        `${error.message} Al ${doing}: se detiene la sincronización de tipos y se intenta en la siguiente.`,
      );
      if (error instanceof ChannexRateLimitedError) {
        return 'CHANNEX_429';
      }
      return error instanceof ChannexRejectedError
        ? `CHANNEX_${error.status}`
        : 'CHANNEX_UNAVAILABLE';
    }
    throw error;
  }

  private stopped(reason: string): RoomTypeSync {
    return { status: 'NOT_SYNCED', reason };
  }
}

/** Un envío rechazado (`4xx`) no detiene: se sigue con la siguiente categoría. */
function categoryOutcome(sent: SendOutcome): CategoryOutcome {
  return sent.kind === 'STOP' ? sent : { kind: 'DONE' };
}
