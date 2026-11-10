import type { Room } from '../../../../integration/room.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../../integration/room-quote.js';
import type { AvailabilityResult } from '../../../check-room-availability/ports/in/verify-availability.port.js';

/** Símbolo con el que Nest inyecta el servicio en el controlador de la reserva directa. */
export const PREVIEW_DIRECT_RESERVATION = Symbol('PREVIEW_DIRECT_RESERVATION');

/** Una habitación ya asignada a su entrada de la solicitud; `position` es su orden en `rooms`, desde 1. */
export type AssignedRoom = { position: number; room: Room; guestCount: number };

/** Lo que muestra la vista previa (plan, A y punto 11). No se guarda nada. */
export type DirectReservationPreview = {
  categoryRoom: string;
  /** El de `VerifyAvailability.check`: todas las habitaciones de la categoría. */
  availability: AvailabilityResult;
  assignedRooms: AssignedRoom[];
  /** Una por habitación asignada; su `key` es la posición como texto (`"1"`, `"2"`…). */
  quoteRequests: RoomQuoteRequest[];
  quotes: RoomQuote[];
  /** La suma de las personas de las habitaciones. */
  guestCount: number;
};

/** La vista previa de una reserva directa (plan, A, D1 y punto 11): asigna, verifica y cotiza. */
export interface PreviewDirectReservation {
  /**
   * Los pasos de la regla 2 en su orden: la solicitud, la disponibilidad, la asignación, la capacidad y
   * la cotización. Si falla un paso, no se llega al siguiente: sin disponibilidad no se cotiza (regla 3).
   * @param body El cuerpo tal como llega.
   * @throws BusinessError con los códigos de la tabla C.
   */
  execute(body: unknown): Promise<DirectReservationPreview>;
}
