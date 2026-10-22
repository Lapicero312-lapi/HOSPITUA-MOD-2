import type { Guest } from '../../../domain/guest/guest.js';
import type { DocumentType } from '../../../domain/shared/enums.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const GUEST_REPOSITORY = Symbol('GUEST_REPOSITORY');

/**
 * Lecturas de titulares. Un titular se guarda y se corrige solo con su reserva
 * (`ReservationRepository`); aquí solo hay consultas.
 */
export interface GuestRepository {
  /**
   * El titular de la reserva más reciente (por fecha de creación) con ese documento, para precargarlo
   * en una reserva nueva (`generate-direct-reservation`, FR-011). `null` si no hay ninguno.
   */
  findLatestByDocument(
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<Guest | null>;
}
