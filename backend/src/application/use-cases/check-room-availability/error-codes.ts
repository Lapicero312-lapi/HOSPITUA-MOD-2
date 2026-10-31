import { RoomOverlapError } from '../../ports/out/reservation.repository.js';
import { BusinessError } from '../../../domain/shared/business-error.js';

export const INVALID_AVAILABILITY_QUERY = {
  code: 'INVALID_AVAILABILITY_QUERY',
  message: 'Debe indicar una categoría o una habitación.',
} as const;

export const AVAILABILITY_TAKEN = {
  code: 'AVAILABILITY_TAKEN',
  message: 'Ya no hay disponibilidad para las fechas solicitadas.',
} as const;

export function translateReservationOverlap(
  error: unknown,
  flow: 'direct' | 'update',
  roomNumber: string,
): BusinessError {
  if (!(error instanceof RoomOverlapError)) {
    throw error;
  }

  if (flow === 'update') {
    return new BusinessError(
      'ROOM_NOT_AVAILABLE',
      `La habitación ${roomNumber} no está disponible para el rango de fechas solicitado.`,
    );
  }

  return new BusinessError(AVAILABILITY_TAKEN.code, AVAILABILITY_TAKEN.message);
}
