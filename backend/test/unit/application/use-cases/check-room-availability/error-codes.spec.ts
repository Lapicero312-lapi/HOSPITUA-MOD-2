import { describe, expect, it } from 'vitest';
import { RoomOverlapError } from '../../../../../src/application/ports/out/reservation.repository.js';
import { translateReservationOverlap } from '../../../../../src/application/use-cases/check-room-availability/error-codes.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';

describe('translateReservationOverlap', () => {
  it('traduce la violación de exclusión a AVAILABILITY_TAKEN en reservas directas', () => {
    const error = translateReservationOverlap(
      new RoomOverlapError(),
      'direct',
      '201',
    );

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.errorCode).toBe('AVAILABILITY_TAKEN');
    expect(error.message).toBe(
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );
  });

  it('traduce la violación de exclusión a ROOM_NOT_AVAILABLE en modificaciones', () => {
    const error = translateReservationOverlap(
      new RoomOverlapError(),
      'update',
      '201',
    );

    expect(error.errorCode).toBe('ROOM_NOT_AVAILABLE');
    expect(error.message).toBe(
      'La habitación 201 no está disponible para el rango de fechas solicitado.',
    );
  });

  it('repite cualquier otro error sin traducirlo', () => {
    const other = new Error('fallo distinto');

    expect(() => translateReservationOverlap(other, 'direct', '201')).toThrow(
      other,
    );
  });
});
