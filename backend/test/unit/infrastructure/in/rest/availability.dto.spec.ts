import { describe, expect, it } from 'vitest';
import type { Room } from '../../../../../src/application/integration/room.js';
import type { AvailabilityResult } from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import { toAvailabilityDto } from '../../../../../src/infrastructure/in/rest/availability.dto.js';

/** Las habitaciones, las fechas y el mantenimiento del ejemplo del DTO del plan (B). */
const room = (roomNumber: string, id: string): Room => ({
  id,
  roomNumber,
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
});
const ROOM_201 = room('201', '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70');
const ROOM_202 = room('202', '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51');
const ROOM_203 = room('203', 'c8e4b2a6-5d7f-4a1c-8e3b-9f0a1b2c3d42');

const EXAMPLE: AvailabilityResult = {
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  rooms: [
    { room: ROOM_201, available: true, reason: null, maintenance: [] },
    { room: ROOM_202, available: false, reason: 'RESERVED', maintenance: [] },
    {
      room: ROOM_203,
      available: false,
      reason: 'MAINTENANCE',
      maintenance: [{ overlapStart: '2026-10-11', overlapEnd: '2026-10-12' }],
    },
  ],
};

describe('toAvailabilityDto (DTO compartido availability, T011)', () => {
  it('convierte el resultado del ejemplo del plan en el JSON de B, con el mensaje de cada motivo', () => {
    expect(toAvailabilityDto(EXAMPLE, 'DOBLE')).toStrictEqual({
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      categoryRoom: 'DOBLE',
      availableCount: 1,
      rooms: [
        {
          roomId: ROOM_201.id,
          roomNumber: '201',
          available: true,
          reason: null,
          message: null,
        },
        {
          roomId: ROOM_202.id,
          roomNumber: '202',
          available: false,
          reason: 'RESERVED',
          message: 'La habitación ya está reservada en esas fechas.',
        },
        {
          roomId: ROOM_203.id,
          roomNumber: '203',
          available: false,
          reason: 'MAINTENANCE',
          message:
            'La habitación estará inhabilitada por mantenimiento en esas fechas.',
          maintenance: [
            { overlapStart: '2026-10-11', overlapEnd: '2026-10-12' },
          ],
        },
      ],
    });
  });

  it('solo una habitación en mantenimiento lleva maintenance', () => {
    const { rooms } = toAvailabilityDto(EXAMPLE, 'DOBLE');

    expect(rooms.map((dto) => 'maintenance' in dto)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('verificada una habitación por roomId, categoryRoom es null', () => {
    const dto = toAvailabilityDto(
      { ...EXAMPLE, rooms: [EXAMPLE.rooms[0]] },
      null,
    );

    expect(dto.categoryRoom).toBeNull();
    expect(dto.availableCount).toBe(1);
  });

  it('cuenta las disponibles', () => {
    const allFree: AvailabilityResult = {
      ...EXAMPLE,
      rooms: EXAMPLE.rooms.map((availability) => ({
        ...availability,
        available: true,
        reason: null,
        maintenance: [],
      })),
    };

    expect(toAvailabilityDto(allFree, 'DOBLE').availableCount).toBe(3);
  });

  it('sin habitaciones, availableCount es 0 y rooms está vacío', () => {
    expect(toAvailabilityDto({ ...EXAMPLE, rooms: [] }, 'DOBLE')).toStrictEqual(
      {
        startDate: '2026-10-10',
        endDate: '2026-10-12',
        categoryRoom: 'DOBLE',
        availableCount: 0,
        rooms: [],
      },
    );
  });

  it('de cada habitación solo salen sus campos del DTO: no la categoría ni la capacidad, ni ningún otro dato', () => {
    const withExtra = {
      ...EXAMPLE,
      rooms: [
        {
          ...EXAMPLE.rooms[1],
          room: { ...ROOM_202, reservationRef: 'RSV-0A1B2C3D' } as Room,
        },
      ],
    };

    const [dto] = toAvailabilityDto(withExtra, 'DOBLE').rooms;

    expect(Object.keys(dto).sort()).toEqual([
      'available',
      'message',
      'reason',
      'roomId',
      'roomNumber',
    ]);
    expect(JSON.stringify(dto)).not.toContain('RSV-0A1B2C3D');
  });
});
