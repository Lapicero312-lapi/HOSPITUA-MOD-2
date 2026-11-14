import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { projectReservation } from '../../../../src/domain/reservation/reservation-projection.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
  anOtaRoom,
} from '../../../support/builders.js';

/**
 * El ejemplo de la lista del día del plan de `check-view-reservation` (contrato con el Módulo 1): la
 * reserva directa `RSV-3F9A1C7B` del 2026-10-09 al 2026-10-12, la 201 `DOBLE` con 2 personas y la
 * titular Ana Pérez. El `updatedAt` es como lo entrega el repositorio, y la proyección lo copia igual.
 */
const ROOM_ID = randomUUID();
const GUEST_REF = randomUUID();

function planReservation() {
  return aDirectReservation({
    reservationRef: 'RSV-3F9A1C7B',
    startDate: '2026-10-09',
    endDate: '2026-10-12',
    status: 'ACTIVE',
    notes: 'Llegada tarde',
    updatedAt: '2026-10-08 15:42:10.123456-05',
    rooms: [
      aDirectRoom({
        roomId: ROOM_ID,
        roomNumber: '201',
        categoryRoom: 'DOBLE',
        guestCount: 2,
      }),
    ],
    guest: aGuest({
      id: GUEST_REF,
      firstName: 'Ana',
      lastName: 'Pérez',
      documentType: 'CC',
      documentNumber: '123',
      nationality: 'Colombia',
      contactPhone: '+57 300 000 0000',
      contactEmail: 'ana@correo.com',
    }),
  });
}

describe('projectReservation', () => {
  it('una reserva directa sale con la forma del ejemplo del plan', () => {
    expect(projectReservation(planReservation(), null)).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      status: 'ACTIVE',
      source: 'DIRECTA',
      startDate: '2026-10-09',
      endDate: '2026-10-12',
      guestCount: 2,
      notes: 'Llegada tarde',
      updatedAt: '2026-10-08 15:42:10.123456-05',
      rooms: [
        {
          roomId: ROOM_ID,
          roomNumber: '201',
          categoryRoom: 'DOBLE',
          guestCount: 2,
        },
      ],
      guest: {
        guestRef: GUEST_REF,
        firstName: 'Ana',
        lastName: 'Pérez',
        fullName: 'Ana Pérez',
        documentType: 'CC',
        documentNumber: '123',
        nationality: 'Colombia',
        contactPhone: '+57 300 000 0000',
        contactEmail: 'ana@correo.com',
      },
    });
  });

  it('con varias habitaciones, el guestCount es el total de personas (FR-014: la suma de las habitaciones)', () => {
    const projection = projectReservation(
      aDirectReservation({
        updatedAt: '2026-10-08 15:42:10-05',
        rooms: [
          aDirectRoom({ roomNumber: '201', guestCount: 2 }),
          aDirectRoom({ roomNumber: '202', guestCount: 1 }),
        ],
      }),
      null,
    );

    expect(projection.guestCount).toBe(3);
    expect(projection.rooms.map((room) => room.guestCount)).toEqual([2, 1]);
  });

  it('una reserva de Booking lleva BOOKING y su externalConfirmationCode', () => {
    const projection = projectReservation(
      anOtaReservation(randomUUID(), {
        updatedAt: '2026-10-08 15:42:10.123456-05',
      }),
      'Booking.com',
    );

    expect(projection.source).toBe('BOOKING');
    expect(projection.externalConfirmationCode).toBe('4417829013');
  });

  it('una reserva directa no lleva externalConfirmationCode', () => {
    expect(projectReservation(planReservation(), null)).not.toHaveProperty(
      'externalConfirmationCode',
    );
  });

  it('nunca lleva importes, comisión ni tarifas (FR-015)', () => {
    const text = JSON.stringify(
      projectReservation(
        anOtaReservation(randomUUID(), { updatedAt: '2026-10-08 15:42:10-05' }),
        'Booking.com',
      ),
    );

    for (const forbidden of [
      'grossAmount',
      'commission',
      'roomGrossAmount',
      'quoteId',
      'currency',
      'rate',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('un teléfono o un correo que no existen viajan null', () => {
    const projection = projectReservation(
      aDirectReservation({
        updatedAt: '2026-10-08 15:42:10-05',
        guest: aGuest({ contactPhone: null, contactEmail: null }),
      }),
      null,
    );

    expect(projection.guest.contactPhone).toBeNull();
    expect(projection.guest.contactEmail).toBeNull();
  });

  it('updatedAt pasa tal como lo entrega el repositorio: para el dominio es opaco (plan base)', () => {
    const updatedAt = '2026-10-08 20:42:10.12+00';

    expect(
      projectReservation(aDirectReservation({ updatedAt }), null).updatedAt,
    ).toBe(updatedAt);
  });

  it('no proyecta una reserva con una habitación sin asignar', () => {
    const reservation = anOtaReservation(randomUUID(), {
      updatedAt: '2026-10-08 15:42:10-05',
      rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
    });

    expect(() => projectReservation(reservation, 'Booking.com')).toThrow();
  });

  it('no proyecta una reserva de OTA sin el nombre de su agencia', () => {
    const reservation = anOtaReservation(randomUUID(), {
      updatedAt: '2026-10-08 15:42:10-05',
    });

    expect(() => projectReservation(reservation, null)).toThrow();
  });

  it('no proyecta una reserva sin guardar', () => {
    expect(() =>
      projectReservation(aDirectReservation({ updatedAt: null }), null),
    ).toThrow();
  });
});
