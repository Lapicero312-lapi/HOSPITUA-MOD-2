import { describe, expect, it } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { AvailabilityResult } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import { assignDirectRooms } from '../../../../../src/application/use-cases/generate-direct-reservation/assign-direct-rooms.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { aRoomAvailability } from '../../../../support/room-availability.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

const ROOM_203: Room = {
  id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e',
  roomNumber: '203',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

/** La categoría DOBLE con la 201, la 202 y la 203, en el orden en que se pasen. */
function availabilityOf(
  ...rooms: ReturnType<typeof aRoomAvailability<Room>>[]
): AvailabilityResult {
  return { startDate: '2026-10-12', endDate: '2026-10-15', rooms };
}

const ALL_FREE = availabilityOf(
  aRoomAvailability(ROOM_201),
  aRoomAvailability(ROOM_202),
  aRoomAvailability(ROOM_203),
);

function businessErrorOf(action: () => unknown): BusinessError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    return error as BusinessError;
  }
  throw new Error('Se esperaba un BusinessError.');
}

describe('assignDirectRooms (plan de generate-direct-reservation, punto 11, pasos 3 y 4)', () => {
  describe('sin roomId: las disponibles de menor roomNumber', () => {
    it('asigna en el orden de la solicitud, con la posición desde 1 y las personas de cada entrada', () => {
      const assigned = assignDirectRooms(
        [
          { guestCount: 2, roomId: null },
          { guestCount: 1, roomId: null },
        ],
        ALL_FREE,
      );

      expect(assigned).toEqual([
        { position: 1, room: ROOM_201, guestCount: 2 },
        { position: 2, room: ROOM_202, guestCount: 1 },
      ]);
    });

    it('el orden es por roomNumber, no por el orden en que llegan del inventario', () => {
      const assigned = assignDirectRooms(
        [{ guestCount: 1, roomId: null }],
        availabilityOf(
          aRoomAvailability(ROOM_203),
          aRoomAvailability(ROOM_202),
        ),
      );

      expect(assigned.map(({ room }) => room.roomNumber)).toEqual(['202']);
    });

    it('salta las que no están disponibles', () => {
      const assigned = assignDirectRooms(
        [{ guestCount: 2, roomId: null }],
        availabilityOf(
          aRoomAvailability(ROOM_201, { available: false, reason: 'RESERVED' }),
          aRoomAvailability(ROOM_202, {
            available: false,
            reason: 'MAINTENANCE',
          }),
          aRoomAvailability(ROOM_203),
        ),
      );

      expect(assigned.map(({ room }) => room.roomNumber)).toEqual(['203']);
    });

    it('si no alcanzan las disponibles: NO_AVAILABILITY con el mensaje literal del spec', () => {
      const error = businessErrorOf(() =>
        assignDirectRooms(
          [
            { guestCount: 1, roomId: null },
            { guestCount: 1, roomId: null },
          ],
          availabilityOf(
            aRoomAvailability(ROOM_201),
            aRoomAvailability(ROOM_202, {
              available: false,
              reason: 'RESERVED',
            }),
          ),
        ),
      );

      expect(error.errorCode).toBe('NO_AVAILABILITY');
      expect(error.message).toBe(
        'Error 400: La habitación no está disponible para el rango de fechas solicitado',
      );
    });

    it('las mismas habitaciones que las pedidas alcanzan justo', () => {
      const assigned = assignDirectRooms(
        [
          { guestCount: 1, roomId: null },
          { guestCount: 1, roomId: null },
          { guestCount: 1, roomId: null },
        ],
        ALL_FREE,
      );

      expect(assigned.map(({ room }) => room.roomNumber)).toEqual([
        '201',
        '202',
        '203',
      ]);
    });
  });

  describe('con roomId: se verifica esa habitación', () => {
    it('la elegida queda en su posición y las demás reciben las de menor roomNumber sin repetirla', () => {
      const assigned = assignDirectRooms(
        [
          { guestCount: 1, roomId: null },
          { guestCount: 2, roomId: ROOM_201.id },
          { guestCount: 1, roomId: null },
        ],
        ALL_FREE,
      );

      expect(assigned).toEqual([
        { position: 1, room: ROOM_202, guestCount: 1 },
        { position: 2, room: ROOM_201, guestCount: 2 },
        { position: 3, room: ROOM_203, guestCount: 1 },
      ]);
    });

    it('el roomId se compara sin distinguir mayúsculas', () => {
      const assigned = assignDirectRooms(
        [{ guestCount: 1, roomId: ROOM_202.id.toUpperCase() }],
        ALL_FREE,
      );

      expect(assigned).toEqual([
        { position: 1, room: ROOM_202, guestCount: 1 },
      ]);
    });

    it('si no está en el resultado (no existe o es de otra categoría): INVALID_ROOM_ID', () => {
      const error = businessErrorOf(() =>
        assignDirectRooms(
          [{ guestCount: 1, roomId: '00000000-0000-4000-8000-000000000000' }],
          ALL_FREE,
        ),
      );

      expect(error.errorCode).toBe('INVALID_ROOM_ID');
      expect(error.message).toBe(
        'El identificador de la habitación es inválido.',
      );
    });

    it.each(['RESERVED', 'MAINTENANCE'] as const)(
      'si no está disponible (%s): ROOM_NOT_AVAILABLE con su número, aunque haya otras libres',
      (reason) => {
        const error = businessErrorOf(() =>
          assignDirectRooms(
            [{ guestCount: 1, roomId: ROOM_202.id }],
            availabilityOf(
              aRoomAvailability(ROOM_201),
              aRoomAvailability(ROOM_202, { available: false, reason }),
            ),
          ),
        );

        expect(error.errorCode).toBe('ROOM_NOT_AVAILABLE');
        expect(error.message).toBe(
          'La habitación 202 no está disponible para el rango de fechas solicitado.',
        );
      },
    );

    it('la elegida no disponible se informa antes que la falta de habitaciones para las demás', () => {
      const error = businessErrorOf(() =>
        assignDirectRooms(
          [
            { guestCount: 1, roomId: null },
            { guestCount: 1, roomId: ROOM_201.id },
          ],
          availabilityOf(
            aRoomAvailability(ROOM_201, {
              available: false,
              reason: 'RESERVED',
            }),
          ),
        ),
      );

      expect(error.errorCode).toBe('ROOM_NOT_AVAILABLE');
    });

    it('con las elegidas ocupando las únicas libres, las demás dan NO_AVAILABILITY', () => {
      const error = businessErrorOf(() =>
        assignDirectRooms(
          [
            { guestCount: 1, roomId: ROOM_201.id },
            { guestCount: 1, roomId: null },
          ],
          availabilityOf(aRoomAvailability(ROOM_201)),
        ),
      );

      expect(error.errorCode).toBe('NO_AVAILABILITY');
    });
  });

  describe('capacidad de cada habitación asignada', () => {
    it('las personas iguales al maxCapacity se aceptan', () => {
      // La 201 admite 2 y la 202 admite 3.
      const assigned = assignDirectRooms(
        [
          { guestCount: 2, roomId: null },
          { guestCount: 3, roomId: null },
        ],
        ALL_FREE,
      );

      expect(assigned.map(({ guestCount }) => guestCount)).toEqual([2, 3]);
    });

    it('más personas que el maxCapacity: GUEST_COUNT_EXCEEDS_CAPACITY con el mensaje del spec', () => {
      const error = businessErrorOf(() =>
        assignDirectRooms([{ guestCount: 3, roomId: null }], ALL_FREE),
      );

      expect(error.errorCode).toBe('GUEST_COUNT_EXCEEDS_CAPACITY');
      expect(error.message).toBe(
        'La cantidad de personas supera la capacidad de la habitación.',
      );
    });

    it('se compara con la habitación que le tocó a esa entrada, no con otra', () => {
      // 3 personas caben en la 202 (posición 1, elegida) y 2 en la 201 (posición 2, asignada).
      const assigned = assignDirectRooms(
        [
          { guestCount: 3, roomId: ROOM_202.id },
          { guestCount: 2, roomId: null },
        ],
        ALL_FREE,
      );

      expect(assigned.map(({ room }) => room.roomNumber)).toEqual([
        '202',
        '201',
      ]);
    });

    it('la falta de habitaciones se informa antes que la capacidad', () => {
      const error = businessErrorOf(() =>
        assignDirectRooms(
          [
            { guestCount: 9, roomId: null },
            { guestCount: 1, roomId: null },
          ],
          availabilityOf(aRoomAvailability(ROOM_201)),
        ),
      );

      expect(error.errorCode).toBe('NO_AVAILABILITY');
    });
  });
});
