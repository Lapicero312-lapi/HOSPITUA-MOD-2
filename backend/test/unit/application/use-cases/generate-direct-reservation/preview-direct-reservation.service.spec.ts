import { describe, expect, it, vi } from 'vitest';
import type { RoomQuote } from '../../../../../src/application/integration/room-quote.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { CalculateDynamicRate } from '../../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import type {
  AvailabilityResult,
  VerifyAvailability,
} from '../../../../../src/application/use-cases/check-room-availability/ports/in/verify-availability.port.js';
import { PreviewDirectReservationService } from '../../../../../src/application/use-cases/generate-direct-reservation/preview-direct-reservation.service.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import { Money } from '../../../../../src/domain/shared/money.js';
import { aRoomAvailability } from '../../../../support/room-availability.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/** El día operativo: el 2026-10-09, el del ejemplo del plan. */
const TODAY = '2026-10-09';

/** La solicitud del ejemplo de A. */
const REQUEST = {
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
};

const BOTH_FREE: AvailabilityResult = {
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: [aRoomAvailability(ROOM_201), aRoomAvailability(ROOM_202)],
};

function aQuote(key: string): RoomQuote {
  return {
    key,
    quoteId: `quote-${key}`,
    currency: 'COP',
    nightlyRates: [
      { date: '2026-10-12', rate: Money.of('250000.00', 'COP') },
      { date: '2026-10-13', rate: Money.of('250000.00', 'COP') },
      { date: '2026-10-14', rate: Money.of('250000.00', 'COP') },
    ],
    lodgingAmount: Money.of('750000.00', 'COP'),
  };
}

function aService(availability: AvailabilityResult = BOTH_FREE) {
  const clock: Clock = { today: () => TODAY, now: () => new Date() };
  const check = vi
    .fn<VerifyAvailability['check']>()
    .mockResolvedValue(availability);
  const quoteRooms = vi
    .fn<CalculateDynamicRate['quoteRooms']>()
    .mockImplementation((requests) =>
      Promise.resolve(requests.map(({ key }) => aQuote(key))),
    );
  const verifyQuotes = vi.fn<CalculateDynamicRate['verifyQuotes']>();
  return {
    service: new PreviewDirectReservationService(
      clock,
      { check },
      { quoteRooms, verifyQuotes },
    ),
    check,
    quoteRooms,
    verifyQuotes,
  };
}

describe('PreviewDirectReservation (plan de generate-direct-reservation, A, D1 y punto 11; T007)', () => {
  it('con el ejemplo de A: verifica la categoría, asigna la 201 y la 202 y cotiza una vez por habitación', async () => {
    const { service, check, quoteRooms } = aService();

    const preview = await service.execute(REQUEST);

    expect(preview).toEqual({
      categoryRoom: 'DOBLE',
      availability: BOTH_FREE,
      assignedRooms: [
        { position: 1, room: ROOM_201, guestCount: 2 },
        { position: 2, room: ROOM_202, guestCount: 2 },
      ],
      quoteRequests: [
        {
          key: '1',
          categoryRoom: 'DOBLE',
          startDate: '2026-10-12',
          endDate: '2026-10-15',
        },
        {
          key: '2',
          categoryRoom: 'DOBLE',
          startDate: '2026-10-12',
          endDate: '2026-10-15',
        },
      ],
      quotes: [aQuote('1'), aQuote('2')],
      guestCount: 4,
    });
    // Una sola verificación, de toda la categoría y sin `limit`: la pantalla muestra todas las habitaciones.
    expect(check).toHaveBeenCalledExactlyOnceWith({
      startDate: '2026-10-12',
      endDate: '2026-10-15',
      categoryRoom: 'DOBLE',
    });
    expect(quoteRooms).toHaveBeenCalledExactlyOnceWith(
      preview.quoteRequests,
      'NEW_RESERVATION',
    );
  });

  it('el guestCount de la reserva es la suma de sus habitaciones', async () => {
    const { service } = aService();

    const preview = await service.execute({
      ...REQUEST,
      rooms: [{ guestCount: 1 }, { guestCount: 3 }],
    });

    expect(preview.guestCount).toBe(4);
  });

  it('no usa verifyQuotes: en la vista previa no hay tarifas vistas que comparar', async () => {
    const { service, verifyQuotes } = aService();

    await service.execute(REQUEST);

    expect(verifyQuotes).not.toHaveBeenCalled();
  });

  describe('la solicitud se revisa antes de consultar la disponibilidad o cotizar (FR-001a)', () => {
    it.each([
      [
        'la entrada es anterior al día operativo',
        { ...REQUEST, startDate: '2026-10-08' },
        'START_DATE_IN_PAST',
      ],
      [
        'la salida no es posterior a la entrada',
        { ...REQUEST, endDate: '2026-10-12' },
        'INVALID_RESERVATION_DATES',
      ],
      ['no hay habitaciones', { ...REQUEST, rooms: [] }, 'INVALID_ROOM_COUNT'],
      [
        'una habitación tiene 0 personas',
        { ...REQUEST, rooms: [{ guestCount: 0 }] },
        'GUEST_COUNT_TOO_LOW',
      ],
    ])('si %s: %s', async (_, body, errorCode) => {
      const { service, check, quoteRooms } = aService();

      await expect(service.execute(body)).rejects.toMatchObject({ errorCode });
      expect(check).not.toHaveBeenCalled();
      expect(quoteRooms).not.toHaveBeenCalled();
    });

    it('el día operativo sale del reloj: la entrada de hoy se acepta', async () => {
      const { service, check } = aService();

      await service.execute({
        ...REQUEST,
        startDate: TODAY,
        endDate: '2026-10-10',
      });

      expect(check).toHaveBeenCalledOnce();
    });
  });

  describe('sin disponibilidad o sin capacidad no se llama al Módulo 3 (regla 3)', () => {
    it('faltan habitaciones: NO_AVAILABILITY', async () => {
      const { service, quoteRooms } = aService({
        ...BOTH_FREE,
        rooms: [
          aRoomAvailability(ROOM_201),
          aRoomAvailability(ROOM_202, { available: false, reason: 'RESERVED' }),
        ],
      });

      await expect(service.execute(REQUEST)).rejects.toMatchObject({
        errorCode: 'NO_AVAILABILITY',
      });
      expect(quoteRooms).not.toHaveBeenCalled();
    });

    it('la habitación pedida por roomId no está disponible: ROOM_NOT_AVAILABLE con su número', async () => {
      const { service, quoteRooms } = aService({
        ...BOTH_FREE,
        rooms: [
          aRoomAvailability(ROOM_201),
          aRoomAvailability(ROOM_202, {
            available: false,
            reason: 'MAINTENANCE',
            maintenance: [
              { overlapStart: '2026-10-13', overlapEnd: '2026-10-14' },
            ],
          }),
        ],
      });

      await expect(
        service.execute({
          ...REQUEST,
          rooms: [{ guestCount: 2, roomId: ROOM_202.id }],
        }),
      ).rejects.toMatchObject({
        errorCode: 'ROOM_NOT_AVAILABLE',
        message:
          'La habitación 202 no está disponible para el rango de fechas solicitado.',
      });
      expect(quoteRooms).not.toHaveBeenCalled();
    });

    it('más personas que la capacidad de la habitación asignada: GUEST_COUNT_EXCEEDS_CAPACITY', async () => {
      const { service, quoteRooms } = aService();

      await expect(
        service.execute({ ...REQUEST, rooms: [{ guestCount: 3 }] }),
      ).rejects.toMatchObject({ errorCode: 'GUEST_COUNT_EXCEEDS_CAPACITY' });
      expect(quoteRooms).not.toHaveBeenCalled();
    });
  });

  it('si la verificación de disponibilidad falla, sale su error y no se cotiza', async () => {
    const { service, check, quoteRooms } = aService();
    check.mockRejectedValue(
      new BusinessError('INVENTORY_UNAVAILABLE', 'El inventario no responde.'),
    );

    await expect(service.execute(REQUEST)).rejects.toMatchObject({
      errorCode: 'INVENTORY_UNAVAILABLE',
    });
    expect(quoteRooms).not.toHaveBeenCalled();
  });

  it('si el Módulo 3 no responde, sale PRICING_UNAVAILABLE tal como lo da la cotización', async () => {
    const { service, quoteRooms } = aService();
    const unavailable = new BusinessError(
      'PRICING_UNAVAILABLE',
      'Error 400: El servicio de cotización de tarifas no se encuentra disponible. Por favor intente más tarde',
    );
    quoteRooms.mockRejectedValue(unavailable);

    await expect(service.execute(REQUEST)).rejects.toBe(unavailable);
  });
});
