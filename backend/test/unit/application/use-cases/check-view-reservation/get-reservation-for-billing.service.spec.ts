import { describe, expect, it, vi } from 'vitest';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import { GetReservationForBillingService } from '../../../../../src/application/use-cases/check-view-reservation/get-reservation-for-billing.service.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import {
  aDirectReservation,
  aDirectRoom,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../../../support/builders.js';

const OTA_ID = '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90';

function serviceFinding(reservation: Reservation | null) {
  const findByRef = vi.fn((_ref: string) => Promise.resolve(reservation));
  const service = new GetReservationForBillingService({
    findByRef,
  } as unknown as ReservationRepository);
  return { service, findByRef };
}

const errorCodeOf = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(BusinessError);
  return (error as BusinessError).errorCode;
};

describe('GetReservationForBilling (plan de check-view-reservation, C4 y "Consulta del Módulo 3"; T032)', () => {
  it('una reserva directa: su canal y el quoteId de cada habitación, en su orden, sin agencia', async () => {
    const reservation = aDirectReservation({
      reservationRef: 'RSV-3F9A1C7B',
      rooms: [
        aDirectRoom({ roomNumber: '201' }),
        aDirectRoom({ roomNumber: '202' }),
      ],
    });
    const { service, findByRef } = serviceFinding(reservation);

    const result = await service.execute('RSV-3F9A1C7B');

    expect(findByRef).toHaveBeenCalledExactlyOnceWith('RSV-3F9A1C7B');
    expect(result).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      channel: 'DIRECT',
      quoteIds: reservation.rooms.map((room) => room.rate?.quoteId),
      ota: null,
    });
    expect(result.quoteIds).toHaveLength(2);
  });

  it('una reserva de Booking: sin cotizaciones, con la agencia, su código y el porcentaje congelado', async () => {
    const reservation = anOtaReservation(OTA_ID, {
      reservationRef: 'RSV-8D02E5A4',
      ota: otaTerms(OTA_ID, {
        externalConfirmationCode: '4417829013',
        commissionPercentage: '15.00',
      }),
      rooms: [anOtaRoom()],
    });
    const { service } = serviceFinding(reservation);

    expect(await service.execute('RSV-8D02E5A4')).toEqual({
      reservationRef: 'RSV-8D02E5A4',
      channel: 'OTA',
      quoteIds: [],
      ota: {
        otaId: OTA_ID,
        confirmationCode: '4417829013',
        commissionPercentage: '15.00',
      },
    });
  });

  it('una reserva que no existe: RESERVATION_NOT_FOUND', async () => {
    const { service } = serviceFinding(null);

    expect(await errorCodeOf(service.execute('RSV-FFFFFFFF'))).toBe(
      'RESERVATION_NOT_FOUND',
    );
  });

  it.each(['RSV-123', 'rsv-3f9a1c7b', 'RSV-3F9A1C7G', ' RSV-3F9A1C7B', ''])(
    'la referencia %j no tiene el formato: INVALID_RESERVATION_CODE sin consultar la base (T017)',
    async (reservationRef) => {
      const { service, findByRef } = serviceFinding(null);

      expect(await errorCodeOf(service.execute(reservationRef))).toBe(
        'INVALID_RESERVATION_CODE',
      );
      expect(findByRef).not.toHaveBeenCalled();
    },
  );
});
