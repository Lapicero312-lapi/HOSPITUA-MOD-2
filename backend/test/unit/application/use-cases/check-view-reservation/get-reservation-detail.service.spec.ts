import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CancellationRepository } from '../../../../../src/application/ports/out/cancellation.repository.js';
import type { OtaRepository } from '../../../../../src/application/ports/out/ota.repository.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import { GetReservationDetailService } from '../../../../../src/application/use-cases/check-view-reservation/get-reservation-detail.service.js';
import { Cancellation } from '../../../../../src/domain/cancellation/cancellation.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
} from '../../../../support/builders.js';

const OTA_ID = '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90';

/** El servicio con los tres repositorios simulados; `stored` es la reserva que hay en la base. */
function aService(stored: Reservation | null) {
  const findByRef = vi
    .fn<ReservationRepository['findByRef']>()
    .mockResolvedValue(stored);
  const findById = vi
    .fn<OtaRepository['findById']>()
    .mockResolvedValue(anOta({ id: OTA_ID, name: 'Booking.com' }));
  const findByReservationId = vi
    .fn<CancellationRepository['findByReservationId']>()
    .mockResolvedValue(null);
  const service = new GetReservationDetailService(
    { findByRef } as unknown as ReservationRepository,
    { findById } as unknown as OtaRepository,
    { findByReservationId } as unknown as CancellationRepository,
  );
  return { service, findByRef, findById, findByReservationId };
}

/** El error de negocio con el que falla `promise`. */
async function businessErrorOf(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BusinessError);
  return error as BusinessError;
}

describe('GetReservationDetail (plan de check-view-reservation, C3; T016 y T017)', () => {
  describe('formato de reservationRef, sin consultar la base (T017)', () => {
    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['sin el prefijo', '3F9A1C7B'],
      ['en minúscula', 'rsv-3f9a1c7b'],
      ['con los hexadecimales en minúscula', 'RSV-3f9a1c7b'],
      ['con 7 caracteres', 'RSV-3F9A1C7'],
      ['con 9 caracteres', 'RSV-3F9A1C7B0'],
      ['con un carácter que no es hexadecimal', 'RSV-3F9A1C7G'],
      ['con espacios alrededor', ' RSV-3F9A1C7B '],
      ['con inyección', "RSV-3F9A1C7B' OR '1'='1"],
    ])('%s: INVALID_RESERVATION_CODE', async (_, reservationRef) => {
      const { service, findByRef } = aService(aDirectReservation());

      const error = await businessErrorOf(service.execute(reservationRef));

      expect(error.errorCode).toBe('INVALID_RESERVATION_CODE');
      expect(error.message).toBe(
        'Debe proveer un código de reserva válido para la consulta.',
      );
      expect(findByRef).not.toHaveBeenCalled();
    });
  });

  it('si la reserva no existe: RESERVATION_NOT_FOUND, "La reserva no existe."', async () => {
    const { service, findByRef } = aService(null);

    const error = await businessErrorOf(service.execute('RSV-0A1B2C3D'));

    expect(error.errorCode).toBe('RESERVATION_NOT_FOUND');
    expect(error.message).toBe('La reserva no existe.');
    expect(findByRef).toHaveBeenCalledExactlyOnceWith('RSV-0A1B2C3D');
  });

  it('una directa activa: la reserva completa y sus noches, sin agencia ni cancelación y sin consultarlas', async () => {
    const reservation = aDirectReservation({
      startDate: '2026-10-23',
      endDate: '2026-10-25',
    });
    const { service, findById, findByReservationId } = aService(reservation);

    await expect(service.execute(reservation.reservationRef)).resolves.toEqual({
      reservation,
      nights: 2,
      otaName: null,
      cancellation: null,
    });
    expect(findById).not.toHaveBeenCalled();
    expect(findByReservationId).not.toHaveBeenCalled();
  });

  it.each([
    ['dentro del mes', '2026-10-23', '2026-10-24', 1],
    ['de un mes al siguiente', '2026-10-30', '2026-11-02', 3],
    ['de un año al siguiente', '2026-12-30', '2027-01-02', 3],
    ['con el 29 de febrero', '2028-02-27', '2028-03-01', 3],
  ])('las noches %s', async (_, startDate, endDate, nights) => {
    const reservation = aDirectReservation({ startDate, endDate });
    const { service } = aService(reservation);

    const detail = await service.execute(reservation.reservationRef);

    expect(detail.nights).toBe(nights);
  });

  it('una OTA: el nombre de su agencia', async () => {
    const reservation = anOtaReservation(OTA_ID);
    const { service, findById } = aService(reservation);

    const detail = await service.execute(reservation.reservationRef);

    expect(detail.otaName).toBe('Booking.com');
    expect(findById).toHaveBeenCalledExactlyOnceWith(OTA_ID);
  });

  it('una OTA cuya agencia no existe es un error del programa, no un error de negocio', async () => {
    const reservation = anOtaReservation(OTA_ID);
    const { service, findById } = aService(reservation);
    findById.mockResolvedValue(null);

    const error: unknown = await service
      .execute(reservation.reservationRef)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BusinessError);
  });

  it('una CANCELLED: su Cancellation, leída por el id de la reserva', async () => {
    const reservation = aDirectReservation({ status: 'CANCELLED' });
    const cancellation = Cancellation.restore({
      id: randomUUID(),
      reservationRef: reservation.reservationRef,
      cancellationDate: new Date('2026-10-09T14:30:00.000Z'),
      reason: 'El huésped cambió de planes',
      channel: 'RECEPTION',
      processedBy: 'Laura Gómez',
      status: 'COMPLETED',
    });
    const { service, findByReservationId } = aService(reservation);
    findByReservationId.mockResolvedValue(cancellation);

    const detail = await service.execute(reservation.reservationRef);

    expect(detail.cancellation).toBe(cancellation);
    expect(findByReservationId).toHaveBeenCalledExactlyOnceWith(reservation.id);
  });

  it.each(['NO_SHOW', 'PENDING', 'IN_PROGRESS', 'COMPLETED'] as const)(
    'una %s no tiene cancelación y no se consulta',
    async (status) => {
      const reservation = aDirectReservation({ status });
      const { service, findByReservationId } = aService(reservation);

      const detail = await service.execute(reservation.reservationRef);

      expect(detail.cancellation).toBeNull();
      expect(findByReservationId).not.toHaveBeenCalled();
    },
  );
});
