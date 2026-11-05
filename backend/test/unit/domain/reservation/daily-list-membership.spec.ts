import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { GuestProps } from '../../../../src/domain/guest/guest.js';
import { DailyListMembership } from '../../../../src/domain/reservation/daily-list-membership.js';
import type { ReservationProps } from '../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOtaRoom,
  otaTerms,
} from '../../../support/builders.js';

/** El día operativo del ejemplo de la lista del día del plan. */
const TODAY = '2026-10-09';
const UPDATED_AT = '2026-10-08 15:42:10.123456-05';
const GUEST: GuestProps = aGuest().snapshot();
const ROOM_201 = aDirectRoom({ roomNumber: '201' });

/** Una reserva guardada que pertenece a la lista de hoy; cada prueba le cambia lo que necesita. */
function aReservation(changes: Partial<ReservationProps> = {}) {
  return aDirectReservation({
    id: 'b3c1f0d2-7a4e-4f6b-9c8d-1e2f3a4b5c6d',
    reservationRef: 'RSV-3F9A1C7B',
    startDate: TODAY,
    endDate: '2026-10-12',
    rooms: [ROOM_201],
    guest: aGuest(GUEST),
    createdAt: new Date('2026-10-01T15:00:00.000Z'),
    updatedAt: UPDATED_AT,
    ...changes,
  });
}

describe('DailyListMembership (plan, "Cuándo una reserva entra, cambia o sale de la lista")', () => {
  describe('belongs: llega el día operativo, está ACTIVE y tiene todas sus habitaciones asignadas', () => {
    it('pertenece', () => {
      expect(DailyListMembership.belongs(aReservation(), TODAY)).toBe(true);
    });

    it('no pertenece si llega otro día', () => {
      expect(
        DailyListMembership.belongs(
          aReservation({ startDate: '2026-10-10' }),
          TODAY,
        ),
      ).toBe(false);
    });

    it.each([
      'PENDING',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ] as const)('no pertenece en %s', (status) => {
      expect(DailyListMembership.belongs(aReservation({ status }), TODAY)).toBe(
        false,
      );
    });

    it('no pertenece si alguna habitación está sin asignar (D13)', () => {
      // Solo una reserva de Booking puede tener una habitación sin asignar.
      const unassigned = anOtaRoom({ roomId: null, roomNumber: null });
      expect(
        DailyListMembership.belongs(
          aReservation({
            source: 'OTA',
            ota: otaTerms(randomUUID()),
            rooms: [anOtaRoom(), unassigned],
            conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
          }),
          TODAY,
        ),
      ).toBe(false);
    });

    it('el día operativo es el que pasa quien llama (el cierre del día pasa el que terminó)', () => {
      expect(DailyListMembership.belongs(aReservation(), '2026-10-10')).toBe(
        false,
      );
    });
  });

  describe('evaluate: cada fila de la tabla', () => {
    it('no pertenece → pertenece: ADDED (creación directa para hoy, sin reserva de antes)', () => {
      expect(DailyListMembership.evaluate(null, aReservation(), TODAY)).toEqual(
        {
          updateType: 'ADDED',
        },
      );
    });

    it('no pertenece → pertenece: ADDED (cambio de llegada a hoy)', () => {
      const before = aReservation({
        startDate: '2026-10-15',
        endDate: '2026-10-17',
      });
      expect(
        DailyListMembership.evaluate(before, aReservation(), TODAY),
      ).toEqual({
        updateType: 'ADDED',
      });
    });

    it('no pertenece → pertenece: ADDED (se asigna la última habitación de una reserva en conflicto)', () => {
      const unassigned = anOtaRoom({ roomId: null, roomNumber: null });
      const ota = otaTerms(randomUUID());
      const before = aReservation({
        source: 'OTA',
        ota,
        rooms: [unassigned],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
      });
      const after = aReservation({
        source: 'OTA',
        ota,
        rooms: [anOtaRoom({ id: unassigned.id, roomNumber: '201' })],
      });

      expect(DailyListMembership.evaluate(before, after, TODAY)).toEqual({
        updateType: 'ADDED',
      });
    });

    it.each<[string, Partial<ReservationProps>]>([
      ['las notas', { notes: 'Llega con mascota' }],
      ['la salida', { endDate: '2026-10-13' }],
      [
        'el titular',
        { guest: aGuest({ ...GUEST, contactPhone: '+57 310 111 2222' }) },
      ],
      [
        'las personas de la habitación',
        { rooms: [aDirectRoom({ ...ROOM_201.snapshot(), guestCount: 1 })] },
      ],
      // Solo la habitación, con las mismas personas: el total de la reserva no cambia.
      [
        'la habitación (de la 201 a la 202)',
        {
          rooms: [
            aDirectRoom({
              ...ROOM_201.snapshot(),
              roomId: randomUUID(),
              roomNumber: '202',
            }),
          ],
        },
      ],
      [
        'la versión (updatedAt)',
        { updatedAt: '2026-10-09 09:15:00.000000-05' },
      ],
    ])('pertenece → pertenece y cambió %s: UPDATED', (_campo, changes) => {
      expect(
        DailyListMembership.evaluate(
          aReservation(),
          aReservation(changes),
          TODAY,
        ),
      ).toEqual({ updateType: 'UPDATED' });
    });

    it('pertenece → pertenece sin cambiar ningún campo de FR-014: nada', () => {
      // La tarifa no viaja al Módulo 1 (FR-015): cambiarla sola no es un campo de FR-014.
      const otherRate = aDirectRoom({
        ...ROOM_201.snapshot(),
        rate: { ...ROOM_201.rate!, quoteId: 'Q-otra' },
      });
      expect(
        DailyListMembership.evaluate(
          aReservation(),
          aReservation({ rooms: [otherRate] }),
          TODAY,
        ),
      ).toBeNull();
    });

    it('pertenece → CANCELLED: REMOVED con CANCELLED', () => {
      expect(
        DailyListMembership.evaluate(
          aReservation(),
          aReservation({
            status: 'CANCELLED',
            statusReason: 'CANCELLED_BY_RECEPTION',
          }),
          TODAY,
        ),
      ).toEqual({ updateType: 'REMOVED', removalReason: 'CANCELLED' });
    });

    it('pertenece → llegada otro día: REMOVED con DATE_CHANGED', () => {
      expect(
        DailyListMembership.evaluate(
          aReservation(),
          aReservation({ startDate: '2026-10-10' }),
          TODAY,
        ),
      ).toEqual({ updateType: 'REMOVED', removalReason: 'DATE_CHANGED' });
    });

    it('pertenece → NO_SHOW: REMOVED con NO_SHOW, con el día que cerró', () => {
      expect(
        DailyListMembership.evaluate(
          aReservation(),
          aReservation({
            status: 'NO_SHOW',
            statusReason: 'DAY_CLOSE_NO_SHOW',
          }),
          TODAY,
        ),
      ).toEqual({ updateType: 'REMOVED', removalReason: 'NO_SHOW' });
    });

    it('pertenece → una habitación queda sin asignar: REMOVED con ROOM_UNASSIGNED', () => {
      const ota = otaTerms(randomUUID());
      const before = aReservation({ source: 'OTA', ota, rooms: [anOtaRoom()] });
      const after = aReservation({
        source: 'OTA',
        ota,
        rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
        conflict: { reason: 'NO_ROOM_AVAILABLE', detectedAt: new Date() },
      });

      expect(DailyListMembership.evaluate(before, after, TODAY)).toEqual({
        updateType: 'REMOVED',
        removalReason: 'ROOM_UNASSIGNED',
      });
    });

    it.each(['IN_PROGRESS', 'COMPLETED'] as const)(
      'pertenece → %s: nada (el Check-In y el Check-Out los ejecuta el Módulo 1, FR-017)',
      (status) => {
        expect(
          DailyListMembership.evaluate(
            aReservation(),
            aReservation({ status }),
            TODAY,
          ),
        ).toBeNull();
      },
    );

    it('no pertenece → no pertenece: nada (escenario 8, llegada dentro de una semana)', () => {
      const nextWeek = { startDate: '2026-10-16', endDate: '2026-10-18' };
      expect(
        DailyListMembership.evaluate(
          aReservation(nextWeek),
          aReservation({
            ...nextWeek,
            rooms: [aDirectRoom({ ...ROOM_201.snapshot(), guestCount: 1 })],
          }),
          TODAY,
        ),
      ).toBeNull();
    });

    it('no pertenece → no pertenece: nada (una reserva nueva con llegada futura)', () => {
      expect(
        DailyListMembership.evaluate(
          null,
          aReservation({ startDate: '2026-10-16', endDate: '2026-10-18' }),
          TODAY,
        ),
      ).toBeNull();
    });

    it('el estado decide antes que la fecha: CANCELLED aunque la llegada también cambie', () => {
      expect(
        DailyListMembership.evaluate(
          aReservation(),
          aReservation({ status: 'CANCELLED', startDate: '2026-10-10' }),
          TODAY,
        ),
      ).toEqual({ updateType: 'REMOVED', removalReason: 'CANCELLED' });
    });

    it('la fecha decide antes que la habitación sin asignar', () => {
      const ota = otaTerms(randomUUID());
      expect(
        DailyListMembership.evaluate(
          aReservation({ source: 'OTA', ota, rooms: [anOtaRoom()] }),
          aReservation({
            source: 'OTA',
            ota,
            startDate: '2026-10-10',
            rooms: [anOtaRoom({ roomId: null, roomNumber: null })],
          }),
          TODAY,
        ),
      ).toEqual({ updateType: 'REMOVED', removalReason: 'DATE_CHANGED' });
    });

    it('una reserva de la lista que sale sin motivo de la tabla es un error del programa', () => {
      expect(() =>
        DailyListMembership.evaluate(
          aReservation(),
          aReservation({ status: 'PENDING' }),
          TODAY,
        ),
      ).toThrow(Error);
    });
  });
});
