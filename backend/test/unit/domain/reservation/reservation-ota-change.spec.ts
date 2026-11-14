import { describe, expect, it } from 'vitest';
import type { OtaChangeInput } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  anOtaReservation,
  anOtaRoom,
} from '../../../support/builders.js';

const NOW = new Date('2031-03-12T15:00:00.000Z');

/** El cambio que deja la reserva igual, salvo lo que se indique. */
const aChange = (changes: Partial<OtaChangeInput> = {}): OtaChangeInput => ({
  startDate: '2031-03-20',
  endDate: '2031-03-22',
  rooms: [],
  notes: null,
  guest: {
    firstName: 'John',
    lastName: 'Smith',
    contactEmail: null,
    contactPhone: null,
    nationality: 'Estados Unidos',
  },
  grossAmount: Money.of('400', 'USD'),
  commission: null,
  conflictReason: null,
  changedAt: NOW,
  ...changes,
});

describe('Reservation.withOtaChange (plan de update-reservation, punto 15; T026)', () => {
  it('una conservada guarda su fila, su habitación y su stayStatus con las personas nuevas; una nueva sin asignar va en EXPECTED y sin tarifa', () => {
    const kept = anOtaRoom({ guestCount: 2, stayStatus: 'EXPECTED' });
    const reservation = anOtaReservation('ota-1', { rooms: [kept] });

    const changed = reservation.withOtaChange(
      aChange({
        rooms: [
          {
            keptRoomId: kept.id,
            room: null,
            categoryRoom: 'DOBLE',
            guestCount: 1,
          },
          {
            keptRoomId: null,
            room: null,
            categoryRoom: 'SUITE',
            guestCount: 2,
          },
        ],
        conflictReason: 'NO_ROOM_AVAILABLE',
      }),
    );

    expect(changed.rooms[0].snapshot()).toEqual({
      ...kept.snapshot(),
      guestCount: 1,
    });
    expect(changed.rooms[1].snapshot()).toMatchObject({
      roomId: null,
      roomNumber: null,
      categoryRoom: 'SUITE',
      guestCount: 2,
      rate: null,
      stayStatus: 'EXPECTED',
    });
    expect(changed.conflict).toEqual({
      reason: 'NO_ROOM_AVAILABLE',
      detectedAt: NOW,
    });
  });

  it('sin comisión nueva conserva el importe; con ella, lo reemplaza', () => {
    const reservation = anOtaReservation('ota-1');
    const [room] = reservation.rooms;
    const rooms = [
      { keptRoomId: room.id, room: null, categoryRoom: 'DOBLE', guestCount: 2 },
    ];

    const same = reservation.withOtaChange(aChange({ rooms }));
    const recalculated = reservation.withOtaChange(
      aChange({
        rooms,
        grossAmount: Money.of('500', 'USD'),
        commission: {
          commissionAmount: Money.of('75.00', 'USD'),
          commissionStatus: 'CALCULATED',
        },
      }),
    );

    expect(same.ota).toEqual(reservation.ota);
    expect(recalculated.ota).toEqual({
      ...reservation.ota,
      grossAmount: Money.of('500', 'USD'),
      commissionAmount: Money.of('75.00', 'USD'),
    });
  });

  it('una reserva directa no se cambia así: es un error del programa', () => {
    expect(() => aDirectReservation().withOtaChange(aChange())).toThrow(
      /es directa/,
    );
  });

  it('una fila conservada que no es de la reserva es un error del programa', () => {
    expect(() =>
      anOtaReservation('ota-1').withOtaChange(
        aChange({
          rooms: [
            {
              keptRoomId: 'otra',
              room: null,
              categoryRoom: 'DOBLE',
              guestCount: 1,
            },
          ],
        }),
      ),
    ).toThrow(/no pertenece/);
  });
});
