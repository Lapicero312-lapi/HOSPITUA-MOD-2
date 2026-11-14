import { Guest } from '../guest/guest.js';
import { isPercentage } from '../ota/ota.js';
import { BusinessError } from '../shared/business-error.js';
import type {
  CommissionStatus,
  ConflictReason,
  ReservationSource,
  ReservationStatus,
  StatusReason,
  StayStatus,
} from '../shared/enums.js';
import {
  GUEST_COUNT_EXCEEDS_CAPACITY,
  INVALID_RESERVATION_DATES,
  INVALID_ROOM_COUNT,
  NOTES_TOO_LONG,
  ROOM_ALREADY_IN_RESERVATION,
} from '../shared/error-codes.js';
import type { Money } from '../shared/money.js';
import { ReservationRoom, type RoomRate } from './reservation-room.js';
import {
  canChangeStatus,
  INITIAL_RESERVATION_STATUS,
  INITIAL_STAY_STATUS,
  invalidStatusTransition,
} from './reservation-transitions.js';

/**
 * Una habitación de una reserva directa nueva: la asignada, sus personas y su tarifa (plan de
 * `generate-direct-reservation`, punto 8). Son datos simples: el dominio no conoce los tipos de
 * `application/` (`Room`, `RoomQuote`).
 */
export type DirectRoomInput = {
  room: {
    roomId: string;
    roomNumber: string;
    categoryRoom: string;
    maxCapacity: number;
  };
  guestCount: number;
  /** El `lodgingAmount` y el `quoteId` de su cotización. */
  rate: RoomRate;
};

/** Lo que necesita `Reservation.createDirect` (plan de `generate-direct-reservation`, punto 8). */
export type DirectReservationInput = {
  /** Ya generada (`newReservationRef`). */
  reservationRef: string;
  startDate: string;
  endDate: string;
  guest: Guest;
  notes: string | null;
  rooms: DirectRoomInput[];
};

/**
 * Una habitación de la reserva modificada (plan de `update-reservation`, regla 9): la fila que se conserva o
 * una nueva, con su habitación del Módulo 1, sus personas y su tarifa.
 */
export type ModifiedRoomInput = {
  /** El `id` de la `ReservationRoom` que se conserva; `null` en una agregada o la nueva de una cambiada. */
  keptRoomId: string | null;
  room: { roomId: string; roomNumber: string; categoryRoom: string };
  guestCount: number;
  rate: RoomRate;
};

/** Lo que cambia `Reservation.withModification`. Un campo en `undefined` queda como está. */
export type ReservationModification = {
  startDate: string;
  endDate: string;
  /** La lista completa de las que quedan, en el orden de la solicitud. */
  rooms: ModifiedRoomInput[];
  /** Los seis datos que se corrigen (FR-001); la nacionalidad no cambia. */
  guest:
    | Pick<
        Guest,
        | 'firstName'
        | 'lastName'
        | 'documentType'
        | 'documentNumber'
        | 'contactPhone'
        | 'contactEmail'
      >
    | undefined;
  /** `null` borra las observaciones. */
  notes: string | null | undefined;
};

/** Datos de una reserva de canal `OTA`: la agencia, su código y la comisión. */
export type OtaTerms = {
  otaId: string;
  externalConfirmationCode: string;
  /** Valor bruto que envía la agencia (`amount` en la revisión de Channex). */
  grossAmount: Money;
  /** El de la agencia al registrar la reserva, congelado; de 0 a 100. */
  commissionPercentage: string;
  /** `grossAmount × commissionPercentage / 100`, en la misma moneda. */
  commissionAmount: Money;
  commissionStatus: CommissionStatus;
};

/** Reserva de Booking que no se pudo ubicar del todo (D13). */
export type Conflict = {
  reason: ConflictReason;
  detectedAt: Date;
};

export type ReservationProps = {
  id: string;
  /** `RSV-` + 8 caracteres hexadecimales en mayúscula. */
  reservationRef: string;
  source: ReservationSource;
  /** `AAAA-MM-DD`, comunes a todas las habitaciones. */
  startDate: string;
  endDate: string;
  rooms: ReservationRoom[];
  guest: Guest;
  status: ReservationStatus;
  /** Motivo de la última transición (D6). */
  statusReason: string | null;
  notes: string | null;
  /** Solo en reservas `OTA`. */
  ota: OtaTerms | null;
  /** Solo en reservas `OTA`. */
  conflict: Conflict | null;
  /** Vacío hasta que la reserva se guarda. */
  createdAt: Date | null;
  /**
   * Versión de la reserva para el control de concurrencia optimista. El dominio no la interpreta: la
   * entrega el repositorio al leerla y se le devuelve igual al guardar. Vacía hasta que la reserva se
   * guarda.
   */
  updatedAt: string | null;
};

const RESERVATION_REF_FORMAT = /^RSV-[0-9A-F]{8}$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROOMS = 10;
const MAX_NOTES_LENGTH = 500;

/**
 * Raíz del agregado de la reserva (plan base, "Agregados e invariantes"): todo cambio pasa por ella y se
 * guarda en una sola transacción, con sus habitaciones y su titular.
 */
export class Reservation {
  private constructor(private readonly props: ReservationProps) {}

  /**
   * Arma una reserva y comprueba sus invariantes. Las fábricas de cada canal (`createDirect`,
   * `createOta`) las agregan los planes que crean reservas.
   */
  static restore(props: ReservationProps): Reservation {
    if (!RESERVATION_REF_FORMAT.test(props.reservationRef)) {
      throw new Error(
        `Reserva inconsistente: referencia con formato inválido (${props.reservationRef}).`,
      );
    }
    if (
      !DATE_FORMAT.test(props.startDate) ||
      !DATE_FORMAT.test(props.endDate) ||
      props.endDate <= props.startDate
    ) {
      throw new BusinessError(
        INVALID_RESERVATION_DATES.code,
        INVALID_RESERVATION_DATES.message,
      );
    }
    if (props.rooms.length < 1 || props.rooms.length > MAX_ROOMS) {
      throw new BusinessError(
        INVALID_ROOM_COUNT.code,
        INVALID_ROOM_COUNT.message,
      );
    }
    const roomIds = props.rooms
      .map((room) => room.roomId)
      .filter((roomId) => roomId !== null);
    if (new Set(roomIds).size !== roomIds.length) {
      throw new BusinessError(
        ROOM_ALREADY_IN_RESERVATION.code,
        ROOM_ALREADY_IN_RESERVATION.message,
      );
    }
    if (props.notes !== null && props.notes.length > MAX_NOTES_LENGTH) {
      throw new BusinessError(NOTES_TOO_LONG.code, NOTES_TOO_LONG.message);
    }
    assertChannel(props);
    return new Reservation({ ...props, rooms: [...props.rooms] });
  }

  /**
   * Una reserva directa nueva (plan de `generate-direct-reservation`, punto 8): en `ACTIVE`, con cada
   * habitación en `EXPECTED`, sin agencia ni conflicto y con comisión `0`. Comprueba las invariantes de
   * `restore` (fechas, de 1 a 10 habitaciones distintas, al menos una persona por habitación y `notes`) y,
   * después, que ninguna habitación supere su capacidad. El orden de la regla 2 lo da el validador de la
   * solicitud (T004), que revisa antes; tampoco comprueba aquí la fecha mínima de entrada, que depende del
   * día operativo.
   * @throws BusinessError con los códigos de `restore` o `GUEST_COUNT_EXCEEDS_CAPACITY`.
   */
  static createDirect(input: DirectReservationInput): Reservation {
    const categories = new Set(
      input.rooms.map(({ room }) => room.categoryRoom),
    );
    // La solicitud trae una sola categoría: si llegan mezcladas, es un error del programa.
    if (categories.size > 1) {
      throw new Error(
        `Reserva directa inconsistente: habitaciones de varias categorías (${[...categories].join(', ')}).`,
      );
    }
    const reservation = Reservation.restore({
      id: crypto.randomUUID(),
      reservationRef: input.reservationRef,
      source: 'DIRECT',
      startDate: input.startDate,
      endDate: input.endDate,
      rooms: input.rooms.map(({ room, guestCount, rate }) =>
        ReservationRoom.restore({
          id: crypto.randomUUID(),
          roomId: room.roomId,
          roomNumber: room.roomNumber,
          categoryRoom: room.categoryRoom,
          guestCount,
          rate,
          stayStatus: INITIAL_STAY_STATUS,
        }),
      ),
      guest: input.guest,
      status: INITIAL_RESERVATION_STATUS,
      statusReason: null,
      notes: input.notes,
      ota: null,
      conflict: null,
      createdAt: null,
      updatedAt: null,
    });
    if (
      input.rooms.some(({ room, guestCount }) => guestCount > room.maxCapacity)
    ) {
      throw new BusinessError(
        GUEST_COUNT_EXCEEDS_CAPACITY.code,
        GUEST_COUNT_EXCEEDS_CAPACITY.message,
      );
    }
    return reservation;
  }

  get id(): string {
    return this.props.id;
  }

  get reservationRef(): string {
    return this.props.reservationRef;
  }

  get source(): ReservationSource {
    return this.props.source;
  }

  get startDate(): string {
    return this.props.startDate;
  }

  get endDate(): string {
    return this.props.endDate;
  }

  get rooms(): readonly ReservationRoom[] {
    return this.props.rooms;
  }

  get guest(): Guest {
    return this.props.guest;
  }

  /** Total de personas: la suma de las de sus habitaciones. */
  get guestCount(): number {
    return this.props.rooms.reduce((total, room) => total + room.guestCount, 0);
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get statusReason(): string | null {
    return this.props.statusReason;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get ota(): OtaTerms | null {
    return this.props.ota;
  }

  get conflict(): Conflict | null {
    return this.props.conflict;
  }

  /** `0` en las reservas directas. */
  get commissionPercentage(): string {
    return this.props.ota?.commissionPercentage ?? '0';
  }

  get createdAt(): Date | null {
    return this.props.createdAt;
  }

  get updatedAt(): string | null {
    return this.props.updatedAt;
  }

  /** Una copia de sus datos, para crear la reserva cambiada con `Reservation.restore`. */
  snapshot(): ReservationProps {
    return { ...this.props, rooms: [...this.props.rooms] };
  }

  /**
   * La reserva de Booking con habitación en las que estaban sin asignar (plan de `update-reservation`, B3 y
   * punto 16; FR-025; T027): cada `reservationRoomId` toma su habitación y su número, y vuelve a ocupar
   * inventario. El conflicto queda con el motivo que diga quien llama: sin motivo se quita; con el mismo,
   * conserva su `detectedAt`; con otro, lo detecta `changedAt`. Nada más cambia.
   * @throws Error si la reserva no es de Booking o una habitación no es suya o ya tiene número: lo revisa
   * antes quien llama.
   */
  withAssignedRooms(change: {
    rooms: { reservationRoomId: string; roomId: string; roomNumber: string }[];
    conflictReason: ConflictReason | null;
    changedAt: Date;
  }): Reservation {
    if (this.props.source !== 'OTA') {
      throw new Error(
        `La reserva ${this.props.reservationRef} es directa: no se le asigna habitación con withAssignedRooms.`,
      );
    }
    const assigned = new Map(
      change.rooms.map((room) => [room.reservationRoomId, room]),
    );
    const rooms = this.props.rooms.map((current) => {
      const chosen = assigned.get(current.id);
      if (chosen === undefined) {
        return current;
      }
      if (current.roomId !== null) {
        throw new Error(
          `La habitación ${current.id} de la reserva ${this.props.reservationRef} ya está asignada.`,
        );
      }
      assigned.delete(current.id);
      return ReservationRoom.restore({
        ...current.snapshot(),
        roomId: chosen.roomId,
        roomNumber: chosen.roomNumber,
      });
    });
    if (assigned.size > 0) {
      throw new Error(
        `Las habitaciones ${[...assigned.keys()].join(', ')} no pertenecen a la reserva ${this.props.reservationRef}.`,
      );
    }
    const { conflict } = this.props;
    return Reservation.restore({
      ...this.props,
      rooms,
      conflict:
        change.conflictReason === null
          ? null
          : {
              reason: change.conflictReason,
              detectedAt:
                conflict !== null && conflict.reason === change.conflictReason
                  ? conflict.detectedAt
                  : change.changedAt,
            },
    });
  }

  /**
   * La reserva de Booking con el cambio que envió la agencia (plan de `update-reservation`, punto 15; T026):
   * - las fechas y las habitaciones del plan: una conservada guarda su fila, su habitación y su
   *   `stayStatus`, con sus personas nuevas; una nueva es otra fila, en `EXPECTED`, con habitación o sin
   *   asignar, y sin tarifa;
   * - las observaciones y el titular (nombre, apellido, correo, teléfono y nacionalidad; el documento no
   *   cambia);
   * - el valor y, si viene, la comisión nueva;
   * - el conflicto: sin motivo se quita; con el mismo que ya tenía conserva su `detectedAt`; con otro, lo
   *   detecta `changedAt`.
   *
   * Nunca la rechaza por falta de lugar ni por capacidad (FR-024). Comprueba las invariantes de `restore`.
   * @throws BusinessError con los códigos de `restore` (las fechas, la cantidad de habitaciones y `notes`).
   */
  withOtaChange(change: OtaChangeInput): Reservation {
    const { ota } = this.props;
    if (this.props.source !== 'OTA' || ota === null) {
      throw new Error(
        `La reserva ${this.props.reservationRef} es directa: no se cambia con withOtaChange.`,
      );
    }
    const rooms = change.rooms.map(
      ({ keptRoomId, room, categoryRoom, guestCount }) => {
        if (keptRoomId === null) {
          return ReservationRoom.restore({
            id: crypto.randomUUID(),
            roomId: room?.roomId ?? null,
            roomNumber: room?.roomNumber ?? null,
            categoryRoom,
            guestCount,
            rate: null,
            stayStatus: INITIAL_STAY_STATUS,
          });
        }
        const kept = this.props.rooms.find(({ id }) => id === keptRoomId);
        if (kept === undefined) {
          throw new Error(
            `La habitación ${keptRoomId} no pertenece a la reserva ${this.props.reservationRef}.`,
          );
        }
        return ReservationRoom.restore({ ...kept.snapshot(), guestCount });
      },
    );
    const { conflict } = this.props;
    return Reservation.restore({
      ...this.props,
      startDate: change.startDate,
      endDate: change.endDate,
      rooms,
      notes: change.notes,
      guest: Guest.restore({
        ...this.props.guest.snapshot(),
        firstName: change.guest.firstName,
        lastName: change.guest.lastName,
        contactEmail: change.guest.contactEmail,
        contactPhone: change.guest.contactPhone,
        nationality: change.guest.nationality,
      }),
      ota: {
        ...ota,
        grossAmount: change.grossAmount,
        ...(change.commission === null
          ? {}
          : {
              commissionAmount: change.commission.commissionAmount,
              commissionStatus: change.commission.commissionStatus,
            }),
      },
      conflict:
        change.conflictReason === null
          ? null
          : {
              reason: change.conflictReason,
              detectedAt:
                conflict !== null && conflict.reason === change.conflictReason
                  ? conflict.detectedAt
                  : change.changedAt,
            },
    });
  }

  /**
   * La reserva con otro `status`, según la tabla de transiciones (FR-006) y las condiciones del plan base:
   * - `IN_PROGRESS`: con al menos una habitación en `CHECKED_IN` (el Check-In de la primera).
   * - `COMPLETED`: sin habitaciones en `EXPECTED` ni en `CHECKED_IN`, y con alguna en `CHECKED_OUT`.
   * - `NO_SHOW`: sus habitaciones en `EXPECTED` pasan a `NOT_ARRIVED` en el mismo cambio (FR-019).
   * @throws BusinessError `INVALID_STATUS_TRANSITION` si no está permitido.
   */
  withStatus(target: ReservationStatus, reason: StatusReason): Reservation {
    if (!canChangeStatus(this.props.status, target) || !this.allows(target)) {
      throw invalidStatusTransition();
    }
    const rooms =
      target === 'NO_SHOW'
        ? this.props.rooms.map((room) =>
            room.stayStatus === 'EXPECTED'
              ? room.withStayStatus('NOT_ARRIVED')
              : room,
          )
        : this.props.rooms;
    return Reservation.restore({
      ...this.props,
      rooms,
      status: target,
      statusReason: reason,
    });
  }

  /**
   * La reserva con otro `stayStatus` en la habitación `roomId`, según la tabla de transiciones
   * (FR-007).
   * @throws BusinessError `INVALID_STATUS_TRANSITION` si no está permitido.
   */
  withStayStatus(roomId: string, target: StayStatus): Reservation {
    const index = this.props.rooms.findIndex((room) => room.roomId === roomId);
    if (index === -1) {
      throw new Error(
        `La habitación ${roomId} no pertenece a la reserva ${this.props.reservationRef}.`,
      );
    }
    const rooms = [...this.props.rooms];
    rooms[index] = rooms[index].withStayStatus(target);
    return Reservation.restore({ ...this.props, rooms });
  }

  /**
   * El cierre del día de una reserva `IN_PROGRESS` (FR-019): sus habitaciones en `EXPECTED`, también las
   * que no tienen habitación asignada, pasan a `NOT_ARRIVED`. El `status` no cambia: si ya no queda ninguna
   * `CHECKED_IN`, quien llama la pasa a `COMPLETED`.
   * @throws BusinessError `INVALID_STATUS_TRANSITION` si la reserva no está en `IN_PROGRESS` (en `ACTIVE` o
   * `PENDING` sus habitaciones pasan a `NOT_ARRIVED` con `NO_SHOW`).
   */
  withNotArrivedRooms(): Reservation {
    if (this.props.status !== 'IN_PROGRESS') {
      throw invalidStatusTransition();
    }
    return Reservation.restore({
      ...this.props,
      rooms: this.props.rooms.map((room) =>
        room.stayStatus === 'EXPECTED'
          ? room.withStayStatus('NOT_ARRIVED')
          : room,
      ),
    });
  }

  /**
   * La reserva directa modificada (plan de `update-reservation`, regla 9; T010 y T011):
   * - las fechas y la lista completa de habitaciones nuevas;
   * - una habitación conservada guarda su fila (`id`), su `roomNumber` y su `stayStatus`, con sus personas
   *   y su tarifa nuevas;
   * - una nueva es otra fila, en `EXPECTED`;
   * - el titular, si viene, guarda su `id` y su `nationality` (regla 6);
   * - `notes`, si viene (`null` las borra).
   *
   * Comprueba las invariantes de `restore`. Las reglas del orden de la regla 3 (fechas, habitaciones,
   * capacidad y disponibilidad) ya las revisó quien llama.
   * @throws BusinessError con los códigos de `restore` o de `ReservationRoom.restore`.
   */
  withModification(change: ReservationModification): Reservation {
    if (this.props.source !== 'DIRECT') {
      // La Recepcionista solo modifica reservas directas (FR-001a): una de Booking es un error del programa.
      throw new Error(
        `La reserva ${this.props.reservationRef} es de Booking: no se modifica con withModification.`,
      );
    }
    const rooms = change.rooms.map(({ keptRoomId, room, guestCount, rate }) => {
      if (keptRoomId === null) {
        return ReservationRoom.restore({
          id: crypto.randomUUID(),
          roomId: room.roomId,
          roomNumber: room.roomNumber,
          categoryRoom: room.categoryRoom,
          guestCount,
          rate,
          stayStatus: INITIAL_STAY_STATUS,
        });
      }
      const kept = this.props.rooms.find(({ id }) => id === keptRoomId);
      if (kept === undefined) {
        throw new Error(
          `La habitación ${keptRoomId} no pertenece a la reserva ${this.props.reservationRef}.`,
        );
      }
      return ReservationRoom.restore({ ...kept.snapshot(), guestCount, rate });
    });
    return Reservation.restore({
      ...this.props,
      startDate: change.startDate,
      endDate: change.endDate,
      rooms,
      guest:
        change.guest === undefined
          ? this.props.guest
          : Guest.restore({
              ...this.props.guest.snapshot(),
              firstName: change.guest.firstName,
              lastName: change.guest.lastName,
              documentType: change.guest.documentType,
              documentNumber: change.guest.documentNumber,
              contactPhone: change.guest.contactPhone,
              contactEmail: change.guest.contactEmail,
            }),
      notes: change.notes === undefined ? this.props.notes : change.notes,
    });
  }

  private allows(target: ReservationStatus): boolean {
    const stays = this.props.rooms.map((room) => room.stayStatus);
    if (target === 'IN_PROGRESS') {
      return stays.includes('CHECKED_IN');
    }
    if (target === 'COMPLETED') {
      return (
        !stays.includes('EXPECTED') &&
        !stays.includes('CHECKED_IN') &&
        stays.includes('CHECKED_OUT')
      );
    }
    return true;
  }

  /**
   * Marca el conflicto de una reserva de Booking que un cambio de Booking no pudo tocar (B3 de
   * `generate-ota-reservation`: una cancelación que llega con la reserva en `IN_PROGRESS`, `COMPLETED` o
   * `NO_SHOW`). Lo demás no cambia.
   * @throws Error si la reserva es directa: una reserva directa nunca está en conflicto.
   */
  withConflict(reason: ConflictReason, detectedAt: Date): Reservation {
    if (this.props.source !== 'OTA') {
      throw new Error(
        `La reserva ${this.props.reservationRef} es directa: no puede estar en conflicto.`,
      );
    }
    return Reservation.restore({
      ...this.props,
      conflict: { reason, detectedAt },
    });
  }

  /**
   * Una reserva de Booking nueva (plan de `generate-ota-reservation`, punto 6): en `ACTIVE`, con cada
   * habitación en `EXPECTED` y sin tarifa por habitación. Nunca la rechaza por falta de lugar ni por
   * capacidad (D13): si hay motivo, marca el conflicto con el primero de `NO_ROOM_AVAILABLE` (alguna
   * habitación sin asignar), `CAPACITY_EXCEEDED` (alguna asignada supera su capacidad) y
   * `CHANGE_NOT_APPLICABLE` (fechas distintas por habitación), con la hora de la revisión.
   * @throws BusinessError con los códigos de `restore` (las fechas, la cantidad de habitaciones y `notes`).
   */
  static createOta(input: OtaReservationInput): Reservation {
    const reason = conflictReasonOf(input);
    return Reservation.restore({
      id: crypto.randomUUID(),
      reservationRef: input.reservationRef,
      source: 'OTA',
      startDate: input.startDate,
      endDate: input.endDate,
      rooms: input.rooms.map(({ categoryRoom, guestCount, assigned }) =>
        ReservationRoom.restore({
          id: crypto.randomUUID(),
          roomId: assigned?.roomId ?? null,
          roomNumber: assigned?.roomNumber ?? null,
          categoryRoom,
          guestCount,
          rate: null,
          stayStatus: INITIAL_STAY_STATUS,
        }),
      ),
      guest: input.guest,
      status: INITIAL_RESERVATION_STATUS,
      statusReason: null,
      notes: input.notes,
      ota: input.ota,
      conflict:
        reason === null ? null : { reason, detectedAt: input.receivedAt },
      createdAt: null,
      updatedAt: null,
    });
  }
}

/** El primer motivo de conflicto de una reserva de Booking nueva, en el orden del paso 8 de B1. */
function conflictReasonOf(input: OtaReservationInput): ConflictReason | null {
  if (input.rooms.some(({ assigned }) => assigned === null)) {
    return 'NO_ROOM_AVAILABLE';
  }
  // Una habitación sin asignar no tiene capacidad: solo se comparan las asignadas.
  if (
    input.rooms.some(
      ({ assigned, guestCount }) =>
        assigned !== null && guestCount > assigned.maxCapacity,
    )
  ) {
    return 'CAPACITY_EXCEEDED';
  }
  return input.datesDifferPerRoom ? 'CHANGE_NOT_APPLICABLE' : null;
}

/**
 * Las reglas de cada canal (plan base). Si no se cumplen es un error del programa, no del usuario: la
 * reserva no se puede armar.
 */
function assertChannel(props: ReservationProps): void {
  const fail = (rule: string): never => {
    throw new Error(`Reserva ${props.reservationRef} inconsistente: ${rule}.`);
  };

  if (props.source === 'DIRECT') {
    if (props.ota !== null || props.conflict !== null) {
      fail('una reserva directa no tiene agencia, comisión ni conflicto');
    }
    if (props.rooms.some((room) => !room.isAssigned || room.rate === null)) {
      fail('cada habitación directa tiene habitación asignada y tarifa');
    }
    return;
  }

  if (props.ota === null) {
    return fail('una reserva OTA tiene agencia, código, valor y comisión');
  }
  if (props.rooms.some((room) => room.rate !== null)) {
    fail('una reserva OTA no tiene tarifa por habitación');
  }
  if (!isPercentage(props.ota.commissionPercentage)) {
    fail('el porcentaje de comisión va de 0 a 100');
  }
  if (props.ota.grossAmount.currency !== props.ota.commissionAmount.currency) {
    fail('el valor y la comisión van en la misma moneda');
  }
}

/**
 * Una habitación de una reserva de Booking nueva (plan de `generate-ota-reservation`, punto 6): su
 * categoría, sus personas y la habitación asignada, o `null` si no hubo lugar. Son datos simples: el
 * dominio no conoce los tipos de `application/`.
 */
export type OtaRoomInput = {
  categoryRoom: string;
  guestCount: number;
  assigned: { roomId: string; roomNumber: string; maxCapacity: number } | null;
};

/** Lo que necesita `Reservation.createOta` (plan de `generate-ota-reservation`, punto 6). */
export type OtaReservationInput = {
  /** Ya generada (`newReservationRef`). */
  reservationRef: string;
  startDate: string;
  endDate: string;
  guest: Guest;
  notes: string | null;
  /** La agencia, el código de Booking, el valor y la comisión calculada. */
  ota: OtaTerms;
  /** La hora de la revisión: la del conflicto, si lo hay. */
  receivedAt: Date;
  rooms: OtaRoomInput[];
  /** Si alguna habitación traía fechas distintas de las de la reserva (paso 4 de B1). */
  datesDifferPerRoom: boolean;
};

/**
 * Lo que cambia `Reservation.withOtaChange` (plan de `update-reservation`, punto 15): el cambio de Booking ya
 * resuelto por `ApplyOtaChange.prepare`. Son datos simples: el dominio no conoce los tipos de `application/`.
 */
export type OtaChangeInput = {
  startDate: string;
  endDate: string;
  /** Una por cada habitación del cambio, en su orden. */
  rooms: {
    /** El `id` de la `ReservationRoom` que se conserva, con la misma habitación; `null` en una nueva. */
    keptRoomId: string | null;
    /** La habitación de una nueva, o `null` si queda sin asignar. */
    room: { roomId: string; roomNumber: string } | null;
    categoryRoom: string;
    guestCount: number;
  }[];
  notes: string | null;
  guest: {
    firstName: string;
    lastName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    nationality: string | null;
  };
  grossAmount: Money;
  /** La comisión recalculada con el porcentaje congelado; `null` si el valor no cambió. */
  commission: {
    commissionAmount: Money;
    commissionStatus: CommissionStatus;
  } | null;
  conflictReason: ConflictReason | null;
  /** La hora del cambio: la del conflicto, si es nuevo. */
  changedAt: Date;
};
