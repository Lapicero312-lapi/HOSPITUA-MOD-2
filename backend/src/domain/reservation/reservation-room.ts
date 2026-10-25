import { BusinessError } from '../shared/business-error.js';
import type { ReservationStatus, StayStatus } from '../shared/enums.js';
import type { Money } from '../shared/money.js';
import {
  canChangeStayStatus,
  invalidStatusTransition,
} from './reservation-transitions.js';

/** Tarifa de una habitación directa, tal como la cotizó el Módulo 3 (D2). */
export type RoomRate = {
  /** El `lodgingAmount` de la cotización, con su moneda. */
  roomGrossAmount: Money;
  quoteId: string;
};

export type ReservationRoomProps = {
  id: string;
  /** `Room.id` del Módulo 1; vacío solo si una reserva de Booking quedó sin habitación (D13). */
  roomId: string | null;
  /** Copia del número del Módulo 1; va junto con `roomId`. */
  roomNumber: string | null;
  categoryRoom: string;
  /** Personas de esa habitación: al menos 1; el tope (`maxCapacity`) lo valida quien la asigna. */
  guestCount: number;
  /** Solo en reservas directas. */
  rate: RoomRate | null;
  stayStatus: StayStatus;
};

const STATUSES_THAT_BLOCK: readonly ReservationStatus[] = [
  'PENDING',
  'ACTIVE',
  'IN_PROGRESS',
];
const STAY_STATUSES_THAT_BLOCK: readonly StayStatus[] = [
  'EXPECTED',
  'CHECKED_IN',
];

/** Habitación dentro de una reserva (plan base, "ReservationRoom"). No existe sin su reserva. */
export class ReservationRoom {
  private constructor(private readonly props: ReservationRoomProps) {}

  static restore(props: ReservationRoomProps): ReservationRoom {
    if ((props.roomId === null) !== (props.roomNumber === null)) {
      throw new Error(
        'Habitación inconsistente: roomId y roomNumber van los dos o ninguno.',
      );
    }
    if (props.categoryRoom.trim() === '') {
      throw new Error('Habitación inconsistente: falta la categoría.');
    }
    if (!Number.isInteger(props.guestCount) || props.guestCount < 1) {
      throw new BusinessError(
        'GUEST_COUNT_TOO_LOW',
        'Cada habitación debe tener al menos una persona.',
      );
    }
    return new ReservationRoom({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get roomId(): string | null {
    return this.props.roomId;
  }

  get roomNumber(): string | null {
    return this.props.roomNumber;
  }

  get categoryRoom(): string {
    return this.props.categoryRoom;
  }

  get guestCount(): number {
    return this.props.guestCount;
  }

  get rate(): RoomRate | null {
    return this.props.rate;
  }

  get stayStatus(): StayStatus {
    return this.props.stayStatus;
  }

  get isAssigned(): boolean {
    return this.props.roomId !== null;
  }

  /**
   * D3: la habitación ocupa inventario mientras su reserva está en `PENDING`, `ACTIVE` o `IN_PROGRESS`,
   * ella está en `EXPECTED` o `CHECKED_IN` y tiene una habitación asignada.
   */
  blocksInventory(reservationStatus: ReservationStatus): boolean {
    return (
      this.isAssigned &&
      STATUSES_THAT_BLOCK.includes(reservationStatus) &&
      STAY_STATUSES_THAT_BLOCK.includes(this.props.stayStatus)
    );
  }

  /**
   * La habitación con otro `stayStatus`, según la tabla de transiciones (FR-007).
   * @throws BusinessError `INVALID_STATUS_TRANSITION` si no está permitido.
   */
  withStayStatus(target: StayStatus): ReservationRoom {
    if (!canChangeStayStatus(this.props.stayStatus, target)) {
      throw invalidStatusTransition();
    }
    return ReservationRoom.restore({ ...this.props, stayStatus: target });
  }

  /** Una copia de sus datos, para crear la habitación cambiada. */
  snapshot(): ReservationRoomProps {
    return { ...this.props };
  }
}
