import { describe, expect, it } from 'vitest';
import { toReservationListRow } from '../../../../../src/application/use-cases/check-view-reservation/reservation-list-row.js';
import type { ReservationProps } from '../../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaReservation,
  anOtaRoom,
  otaTerms,
} from '../../../../support/builders.js';

const OTA_ID = '0f8b2c4e-6a1d-4e3f-9b7c-5d2a1e0f3c4b';
const DETECTED_AT = new Date('2026-10-08T14:00:00.000Z');

/** La reserva del ejemplo de C1 del plan: Valentina Ospina, la 204 `DOBLE`, del 23 al 25 de octubre. */
const planReservation = (changes: Partial<ReservationProps> = {}) =>
  aDirectReservation({
    reservationRef: 'RSV-3F9A1C7B',
    startDate: '2026-10-23',
    endDate: '2026-10-25',
    status: 'ACTIVE',
    rooms: [aDirectRoom({ roomNumber: '204', categoryRoom: 'DOBLE' })],
    guest: aGuest({
      firstName: 'Valentina',
      lastName: 'Ospina',
      documentNumber: '1144093552',
    }),
    ...changes,
  });

const row = (
  reservation = planReservation(),
  { otaName = null as string | null, hasForeignMovement = false } = {},
) => toReservationListRow({ reservation, otaName, hasForeignMovement });

describe('Fila del listado (plan de check-view-reservation, C1 y T010)', () => {
  it('el ejemplo de C1: una reserva directa activa, con las acciones de modificar y cancelar', () => {
    expect(row()).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      externalConfirmationCode: null,
      guest: { fullName: 'Valentina Ospina', documentNumber: '1144093552' },
      rooms: [{ roomNumber: '204', categoryRoom: 'DOBLE' }],
      source: 'DIRECT',
      otaName: null,
      startDate: '2026-10-23',
      endDate: '2026-10-25',
      status: 'ACTIVE',
      migrationStatus: 'AWAITING_CHECK_IN',
      conflict: null,
      actions: { canModify: true, canCancel: true, canAssignRoom: false },
    });
  });

  it('nunca trae importes, comisión ni tarifas (FR-015)', () => {
    expect(Object.keys(row())).toEqual([
      'reservationRef',
      'externalConfirmationCode',
      'guest',
      'rooms',
      'source',
      'otaName',
      'startDate',
      'endDate',
      'status',
      'migrationStatus',
      'conflict',
      'actions',
    ]);
    expect(Object.keys(row().rooms[0])).toEqual(['roomNumber', 'categoryRoom']);
  });

  it('una reserva con varias habitaciones es una sola fila, con todas', () => {
    const reservation = planReservation({
      rooms: [
        aDirectRoom({ roomNumber: '204', categoryRoom: 'DOBLE' }),
        aDirectRoom({ roomNumber: '205', categoryRoom: 'DOBLE' }),
      ],
    });

    expect(row(reservation).rooms).toEqual([
      { roomNumber: '204', categoryRoom: 'DOBLE' },
      { roomNumber: '205', categoryRoom: 'DOBLE' },
    ]);
  });

  describe('acciones (FR-005)', () => {
    it.each([
      ['PENDING', true],
      ['ACTIVE', true],
      ['IN_PROGRESS', false],
      ['COMPLETED', false],
      ['CANCELLED', false],
      ['NO_SHOW', false],
    ] as const)(
      'una directa en %s: modificar y cancelar = %s',
      (status, editable) => {
        expect(row(planReservation({ status })).actions).toEqual({
          canModify: editable,
          canCancel: editable,
          canAssignRoom: false,
        });
      },
    );

    it('una de OTA activa no se modifica ni se cancela desde la pantalla', () => {
      const reservation = anOtaReservation(OTA_ID, { status: 'ACTIVE' });

      expect(row(reservation, { otaName: 'Booking.com' }).actions).toEqual({
        canModify: false,
        canCancel: false,
        canAssignRoom: false,
      });
    });
  });

  describe('migrationStatus (FR-005b)', () => {
    it.each([
      ['ACTIVE', false, 'AWAITING_CHECK_IN'],
      ['PENDING', false, 'AWAITING_CHECK_IN'],
      ['CANCELLED', false, 'NO_CHECK_IN'],
      ['NO_SHOW', false, 'NO_CHECK_IN'],
      ['IN_PROGRESS', true, 'COMPLETE'],
      ['COMPLETED', true, 'COMPLETE'],
      ['IN_PROGRESS', false, 'NOT_REQUIRED'],
      ['COMPLETED', false, 'NOT_REQUIRED'],
    ] as const)(
      '%s, con movimientos de extranjeros = %s: %s',
      (status, hasForeignMovement, migrationStatus) => {
        expect(
          row(planReservation({ status }), { hasForeignMovement })
            .migrationStatus,
        ).toBe(migrationStatus);
      },
    );
  });

  describe('reservas de OTA', () => {
    it('llevan el nombre de la agencia y su código de confirmación', () => {
      const reservation = anOtaReservation(OTA_ID, {
        ota: otaTerms(OTA_ID, { externalConfirmationCode: '4417829013' }),
      });

      expect(row(reservation, { otaName: 'Booking.com' })).toMatchObject({
        source: 'OTA',
        otaName: 'Booking.com',
        externalConfirmationCode: '4417829013',
        guest: { documentNumber: null },
      });
    });

    it('una directa no muestra agencia aunque llegue un nombre', () => {
      expect(
        row(planReservation(), { otaName: 'Booking.com' }).otaName,
      ).toBeNull();
    });

    it('en conflicto con una habitación sin asignar: el conflicto, "Sin asignar" y la acción de asignar (FR-002a)', () => {
      const reservation = anOtaReservation(OTA_ID, {
        rooms: [
          anOtaRoom({ roomNumber: '204', categoryRoom: 'DOBLE' }),
          anOtaRoom({ roomId: null, roomNumber: null, categoryRoom: 'DOBLE' }),
        ],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: DETECTED_AT },
      });

      expect(row(reservation, { otaName: 'Booking.com' })).toMatchObject({
        rooms: [
          { roomNumber: '204', categoryRoom: 'DOBLE' },
          { roomNumber: null, categoryRoom: 'DOBLE' },
        ],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: DETECTED_AT },
        actions: { canModify: false, canCancel: false, canAssignRoom: true },
      });
    });

    it('en conflicto con todas sus habitaciones asignadas: no hay nada que asignar', () => {
      const reservation = anOtaReservation(OTA_ID, {
        conflict: { reason: 'CAPACITY_EXCEEDED', detectedAt: DETECTED_AT },
      });

      expect(
        row(reservation, { otaName: 'Booking.com' }).actions.canAssignRoom,
      ).toBe(false);
    });

    it('una habitación sin asignar sin conflicto marcado no da la acción de asignar: solo se asigna en conflicto (B3)', () => {
      const reservation = anOtaReservation(OTA_ID, {
        rooms: [
          anOtaRoom({ roomId: null, roomNumber: null, categoryRoom: 'DOBLE' }),
        ],
        conflict: null,
      });

      expect(
        row(reservation, { otaName: 'Booking.com' }).actions.canAssignRoom,
      ).toBe(false);
    });
  });
});
