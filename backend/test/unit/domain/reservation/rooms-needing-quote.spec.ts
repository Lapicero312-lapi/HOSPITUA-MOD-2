import { describe, expect, it } from 'vitest';
import { diffRooms } from '../../../../src/domain/reservation/diff-rooms.js';
import { roomsNeedingQuote } from '../../../../src/domain/reservation/rooms-needing-quote.js';

/** Una habitación actual de la reserva: su número es también su `roomId`. */
function current(roomNumber: string, categoryRoom: string) {
  return { roomId: `uuid-${roomNumber}`, roomNumber, categoryRoom };
}

/** Una habitación pedida, con la categoría que da el Módulo 1. */
function requested(roomNumber: string, categoryRoom: string, guestCount = 2) {
  return { roomId: `uuid-${roomNumber}`, categoryRoom, guestCount };
}

type Requested = ReturnType<typeof requested>;

/** La reserva de antes: del 12 al 15 de octubre, con la 201 y la 202 (`DOBLE`). */
const BEFORE = { startDate: '2026-10-12', endDate: '2026-10-15' };
const CURRENT = [current('201', 'DOBLE'), current('202', 'DOBLE')];

/** Los números de las habitaciones que hay que cotizar, para el cambio pedido. */
function quotedFor(
  rooms: Requested[],
  dates: { startDate: string; endDate: string } = BEFORE,
): string[] {
  const after = { ...dates, rooms };
  return roomsNeedingQuote(BEFORE, after, diffRooms(CURRENT, rooms)).map(
    (room) => room.roomId.replace('uuid-', ''),
  );
}

describe('roomsNeedingQuote (plan de calculate-dynamic-rate, B2)', () => {
  describe('una prueba por fila de la tabla', () => {
    it.each([
      ['cambia startDate', { startDate: '2026-10-13', endDate: '2026-10-15' }],
      ['cambia endDate', { startDate: '2026-10-12', endDate: '2026-10-16' }],
      ['cambian las dos', { startDate: '2026-10-20', endDate: '2026-10-22' }],
    ])('%s: todas las de la reserva', (_, dates) => {
      expect(
        quotedFor(
          [requested('201', 'DOBLE'), requested('202', 'DOBLE')],
          dates,
        ),
      ).toEqual(['201', '202']);
    });

    it('se agrega una habitación: solo la agregada', () => {
      expect(
        quotedFor([
          requested('201', 'DOBLE'),
          requested('202', 'DOBLE'),
          requested('301', 'SUITE'),
        ]),
      ).toEqual(['301']);
    });

    it('una habitación cambia de categoría: solo esa habitación', () => {
      expect(
        quotedFor([requested('301', 'SUITE'), requested('202', 'DOBLE')]),
      ).toEqual(['301']);
    });

    it('una habitación se cambia por otra de la misma categoría, sin cambiar fechas: ninguna (hereda la tarifa)', () => {
      expect(
        quotedFor([requested('203', 'DOBLE'), requested('202', 'DOBLE')]),
      ).toEqual([]);
    });

    it('se quita una habitación: ninguna (se va con su tarifa)', () => {
      expect(quotedFor([requested('201', 'DOBLE')])).toEqual([]);
    });

    it('cambia solo guestCount: ninguna', () => {
      expect(
        quotedFor([requested('201', 'DOBLE', 1), requested('202', 'DOBLE', 1)]),
      ).toEqual([]);
    });
  });

  describe('combinaciones', () => {
    it('con las fechas cambiadas, también la cambiada de la misma categoría y sin las quitadas', () => {
      expect(
        quotedFor([requested('203', 'DOBLE')], {
          startDate: '2026-10-13',
          endDate: '2026-10-15',
        }),
      ).toEqual(['203']);
    });

    it('una agregada y una cambiada de categoría, en el orden de la solicitud', () => {
      expect(
        quotedFor([
          requested('401', 'FAMILIAR'),
          requested('202', 'DOBLE'),
          requested('301', 'SUITE'),
        ]),
      ).toEqual(['401', '301']);
    });

    it('una cambiada de la misma categoría y una agregada: solo la agregada', () => {
      expect(
        quotedFor([
          requested('203', 'DOBLE'),
          requested('202', 'DOBLE'),
          requested('301', 'SUITE'),
        ]),
      ).toEqual(['301']);
    });

    it('devuelve las mismas habitaciones pedidas, con todos sus campos', () => {
      const rooms = [requested('201', 'DOBLE'), requested('301', 'SUITE', 3)];

      const quoted = roomsNeedingQuote(
        BEFORE,
        { ...BEFORE, rooms },
        diffRooms(CURRENT, rooms),
      );

      expect(quoted).toEqual([rooms[1]]);
      expect(quoted[0]).toBe(rooms[1]);
    });
  });
});
