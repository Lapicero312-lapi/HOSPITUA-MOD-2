import type { Guest } from '../guest/guest.js';
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
import type { Money } from '../shared/money.js';
import type { ReservationRoom } from './reservation-room.js';
import {
  canChangeStatus,
  invalidStatusTransition,
} from './reservation-transitions.js';

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
        'INVALID_RESERVATION_DATES',
        'La fecha de salida debe ser posterior a la de entrada.',
      );
    }
    if (props.rooms.length < 1 || props.rooms.length > MAX_ROOMS) {
      throw new BusinessError(
        'INVALID_ROOM_COUNT',
        'Una reserva debe tener entre 1 y 10 habitaciones.',
      );
    }
    const roomIds = props.rooms
      .map((room) => room.roomId)
      .filter((roomId) => roomId !== null);
    if (new Set(roomIds).size !== roomIds.length) {
      throw new BusinessError(
        'ROOM_ALREADY_IN_RESERVATION',
        'La habitación ya forma parte de la reserva.',
      );
    }
    if (props.notes !== null && props.notes.length > MAX_NOTES_LENGTH) {
      throw new BusinessError(
        'NOTES_TOO_LONG',
        'Las observaciones no pueden superar 500 caracteres.',
      );
    }
    assertChannel(props);
    return new Reservation({ ...props, rooms: [...props.rooms] });
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
