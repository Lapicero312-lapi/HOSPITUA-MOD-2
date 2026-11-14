import type { Money } from '../../../../../domain/shared/money.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../../../integration/room-quote.js';
import type { RoomAvailability } from '../../../check-room-availability/ports/in/verify-availability.port.js';

/** Símbolo con el que Nest inyecta el servicio en `ReservationsController` (plan base, regla 4). */
export const PREVIEW_MODIFICATION = Symbol('PREVIEW_MODIFICATION');

/** Qué cambia (plan de `update-reservation`, B1 y regla 8). */
export type ModificationChanges = {
  /** `startDate` o `endDate` distintas de las actuales. */
  dates: boolean;
  /** El `roomId` de las agregadas, en el orden de la solicitud. */
  roomsAdded: string[];
  /** El `roomId` de las quitadas, por `roomNumber` ascendente. */
  roomsRemoved: string[];
  /** Las cambiadas, de la misma o de otra categoría: el `roomId` de la que sale y el de la que entra. */
  roomsSwapped: { from: string; to: string }[];
  /** Cambia la suma de personas de la reserva, o las de una habitación conservada. */
  guestCountChanged: boolean;
  /** El titular viene y algún dato difiere del actual. */
  guestChanged: boolean;
  /** `notes` viene y difiere de las actuales. */
  notesChanged: boolean;
};

/** Las cotizaciones de las habitaciones recotizadas y el total de las que quedarían. */
export type ModificationQuotes = {
  /** Una por habitación recotizada, con `key` = su `roomId`. */
  quotes: RoomQuote[];
  /** Las solicitudes que se cotizaron: dan la categoría de cada `key`. */
  requests: RoomQuoteRequest[];
  /** La suma de todas las habitaciones que quedarían (`reservationTotal`); no se guarda. */
  total: Money;
};

/** La vista previa de una modificación (B1). No se guarda nada. */
export type ModificationPreview = {
  reservationRef: string;
  changes: ModificationChanges;
  /** `true` solo si hay cotizaciones que el solicitante debe aceptar. */
  requiresConfirmation: boolean;
  /** Las habitaciones verificadas, en el orden de la solicitud; `[]` si no se verificó ninguna. */
  availability: RoomAvailability[];
  /** `null` si el cambio no recotiza. */
  quotes: ModificationQuotes | null;
  /** Cómo quedaría la reserva: sus fechas y la suma de personas. */
  reservation: { startDate: string; endDate: string; guestCount: number };
};

/**
 * La vista previa de la modificación de una reserva directa (plan de `update-reservation`, B1, D1 y regla
 * 8; T009): valida todo en el orden de la regla 3, verifica la disponibilidad y cotiza lo que corresponda,
 * sin guardar nada.
 */
export interface PreviewModification {
  /**
   * @param body El cuerpo de cambio tal como llegó.
   * @throws BusinessError con los códigos de la tabla de errores de B.
   */
  execute(reservationRef: string, body: unknown): Promise<ModificationPreview>;
}
