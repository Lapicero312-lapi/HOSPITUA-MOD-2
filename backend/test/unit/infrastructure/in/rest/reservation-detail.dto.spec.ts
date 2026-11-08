import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Cancellation } from '../../../../../src/domain/cancellation/cancellation.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { toReservationDetailBody } from '../../../../../src/infrastructure/in/rest/reservation-detail.dto.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
  anOtaRoom,
} from '../../../../support/builders.js';

const ROOM_ID = 'a4c2e1f0-3b5d-4c6e-8f7a-9b0c1d2e3f40';
const OTA_ID = '5b0e7c1a-2f4d-4e8b-9c3a-1d6f8e2b7a90';

describe('toReservationDetailBody (plan de check-view-reservation, C3; T016)', () => {
  it('arma el ejemplo de C3: una directa con su habitación, el importe como texto y createdAt en hora de Colombia', () => {
    const reservation = aDirectReservation({
      reservationRef: 'RSV-3F9A1C7B',
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      notes: 'Llegada tarde',
      createdAt: new Date('2026-10-01T14:14:00.000Z'),
      rooms: [
        aDirectRoom({
          roomId: ROOM_ID,
          roomNumber: '204',
          categoryRoom: 'DOBLE',
          guestCount: 3,
          rate: {
            roomGrossAmount: Money.of('713000', 'COP'),
            quoteId: 'Q-1',
          },
        }),
      ],
      guest: aGuest({
        firstName: 'Valentina',
        lastName: 'Ospina',
        documentType: 'CC',
        documentNumber: '1144093552',
        nationality: 'Colombia',
        contactPhone: '+57 300 000 0000',
        contactEmail: 'valentina@correo.com',
      }),
    });

    expect(
      toReservationDetailBody({
        reservation,
        nights: 2,
        otaName: null,
        cancellation: null,
      }),
    ).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      status: 'ACTIVE',
      source: 'DIRECT',
      externalConfirmationCode: null,
      otaName: null,
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      nights: 2,
      guestCount: 3,
      notes: 'Llegada tarde',
      createdAt: '2026-10-01T09:14:00-05:00',
      conflict: null,
      rooms: [
        {
          roomId: ROOM_ID,
          roomNumber: '204',
          categoryRoom: 'DOBLE',
          guestCount: 3,
          roomGrossAmount: { amount: '713000.00', currency: 'COP' },
          stayStatus: 'EXPECTED',
        },
      ],
      guest: {
        firstName: 'Valentina',
        lastName: 'Ospina',
        documentType: 'CC',
        documentNumber: '1144093552',
        nationality: 'Colombia',
        contactPhone: '+57 300 000 0000',
        contactEmail: 'valentina@correo.com',
      },
      cancellation: null,
    });
  });

  it('una de Booking en conflicto: el código y la agencia, sin importe, la habitación sin asignar en null y el titular sin documento', () => {
    const detectedAt = new Date('2026-10-09T15:00:00.000Z');
    const reservation = anOtaReservation(OTA_ID, {
      conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt },
      rooms: [
        anOtaRoom({ roomId: null, roomNumber: null, categoryRoom: 'DOBLE' }),
      ],
    });

    const body = toReservationDetailBody({
      reservation,
      nights: 2,
      otaName: 'Booking.com',
      cancellation: null,
    });

    expect(body).toMatchObject({
      source: 'OTA',
      externalConfirmationCode: '4417829013',
      otaName: 'Booking.com',
      conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt },
      rooms: [
        {
          roomId: null,
          roomNumber: null,
          categoryRoom: 'DOBLE',
          roomGrossAmount: null,
        },
      ],
      guest: { documentType: null, documentNumber: null },
    });
  });

  it('una cancelada: la cancelación con su fecha en hora de Colombia, el canal, el motivo y quién la procesó', () => {
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

    const body = toReservationDetailBody({
      reservation,
      nights: 2,
      otaName: null,
      cancellation,
    });

    expect(body.cancellation).toEqual({
      cancellationDate: '2026-10-09T09:30:00-05:00',
      channel: 'RECEPTION',
      reason: 'El huésped cambió de planes',
      processedBy: 'Laura Gómez',
    });
  });

  it('sin observaciones, notes va null; sin createdAt (no guardada), createdAt va null', () => {
    const reservation = aDirectReservation({ notes: null, createdAt: null });

    const body = toReservationDetailBody({
      reservation,
      nights: 2,
      otaName: null,
      cancellation: null,
    });

    expect(body.notes).toBeNull();
    expect(body.createdAt).toBeNull();
  });

  it('no lleva comisión, quoteId ni updatedAt (solo lo de C3)', () => {
    const body = toReservationDetailBody({
      reservation: anOtaReservation(OTA_ID),
      nights: 2,
      otaName: 'Booking.com',
      cancellation: null,
    });

    const text = JSON.stringify(body);
    expect(text).not.toContain('commission');
    expect(text).not.toContain('quoteId');
    expect(text).not.toContain('updatedAt');
    expect(text).not.toContain('grossAmount"');
  });
});
