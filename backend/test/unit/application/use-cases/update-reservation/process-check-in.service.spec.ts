import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProcessedMessage,
  ProcessedMessageRepository,
} from '../../../../../src/application/ports/out/processed-message.repository.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type {
  Transaction,
  TransactionRunner,
} from '../../../../../src/application/ports/out/transaction.js';
import type {
  GuestPayload,
  RegisterGuestMovements,
  RegistrationSummary,
} from '../../../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import type { CheckInNotification } from '../../../../../src/application/use-cases/update-reservation/ports/in/process-check-in.port.js';
import { ProcessCheckInService } from '../../../../../src/application/use-cases/update-reservation/process-check-in.service.js';
import { ReservationStatusService } from '../../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import type {
  ReservationStatus,
  StayStatus,
} from '../../../../../src/domain/shared/enums.js';
import {
  aDirectReservation,
  aDirectRoom,
} from '../../../../support/builders.js';

const TX = { tx: 'la del Check-In' } as unknown as Transaction;
const QUEUE = 'm2.habitacion.checkin.queue';
const ROOM_201 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ROOM_202 = '9b2d8f3e-1c4a-4e6b-8f0d-2a3b4c5d6e7f';
const MESSAGE_ID = '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f';

/** Ana y John, del mensaje de Check-In del contrato A. */
const ANA: GuestPayload = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};
const JOHN: GuestPayload = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};

const SUMMARY: RegistrationSummary = {
  received: 2,
  registered: 2,
  alreadyRegistered: 0,
  foreign: 1,
  skipped: 0,
};

/** Una reserva con la 201 y la 202, en el estado pedido. */
function aReservation(
  status: ReservationStatus,
  stays: { room201: StayStatus; room202: StayStatus } = {
    room201: 'EXPECTED',
    room202: 'EXPECTED',
  },
): Reservation {
  return aDirectReservation({
    reservationRef: 'RSV-8D02E5A4',
    status,
    rooms: [
      aDirectRoom({
        roomId: ROOM_201,
        roomNumber: '201',
        stayStatus: stays.room201,
      }),
      aDirectRoom({
        roomId: ROOM_202,
        roomNumber: '202',
        stayStatus: stays.room202,
      }),
    ],
  });
}

function notification(
  changes: Partial<CheckInNotification> = {},
): CheckInNotification {
  return {
    messageId: MESSAGE_ID,
    sequenceNumber: 123,
    queue: QUEUE,
    reservationRef: 'RSV-8D02E5A4',
    roomId: ROOM_201,
    movementDate: '2026-10-09',
    guests: [ANA, JOHN],
    ...changes,
  };
}

/**
 * El servicio con la reserva que encuentra `lockByRef` (o ninguna), los mensajes ya procesados y el mayor
 * `sequenceNumber` de la cola. `ReservationStatusService` es el de verdad, con un repositorio que guarda
 * cada versión de la reserva.
 */
function serviceWith({
  reservation = aReservation('ACTIVE') as Reservation | null,
  processed = [] as string[],
  highestSequence = 122 as number | null,
} = {}) {
  const runs: unknown[] = [];
  const transactions: TransactionRunner = {
    run: (work) => {
      runs.push(work);
      return work(TX);
    },
  };
  const lockByRef = vi
    .fn<ReservationRepository['lockByRef']>()
    .mockResolvedValue(reservation);
  const update = vi
    .fn<ReservationRepository['update']>()
    .mockImplementation((saved) => Promise.resolve(saved));
  const reservations = {
    lockByRef,
    update,
  } as unknown as ReservationRepository;
  const recorded: ProcessedMessage[] = [];
  const isProcessed = vi
    .fn<ProcessedMessageRepository['isProcessed']>()
    .mockImplementation((messageId) =>
      Promise.resolve(processed.includes(messageId)),
    );
  const record = vi
    .fn<ProcessedMessageRepository['record']>()
    .mockImplementation((message) => {
      recorded.push(message);
      return Promise.resolve();
    });
  const highestSequenceNumber = vi
    .fn<ProcessedMessageRepository['highestSequenceNumber']>()
    .mockResolvedValue(highestSequence);
  const register = vi
    .fn<RegisterGuestMovements['register']>()
    .mockResolvedValue(SUMMARY);
  const service = new ProcessCheckInService(
    transactions,
    reservations,
    { isProcessed, record, highestSequenceNumber },
    new ReservationStatusService(reservations),
    { register },
  );
  /** Cada versión guardada de la reserva: su estado y el de la 201 y la 202. */
  const saved = () =>
    update.mock.calls.map(([version]) => ({
      status: version.status,
      statusReason: version.statusReason,
      stays: version.rooms.map(({ stayStatus }) => stayStatus),
    }));
  return {
    service,
    runs,
    lockByRef,
    update,
    isProcessed,
    record,
    recorded,
    highestSequenceNumber,
    register,
    saved,
  };
}

function logs() {
  return {
    warn: vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined),
    log: vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProcessCheckInService (plan de update-reservation, "Check-In (FR-015)" y D3)', () => {
  describe('la notificación válida', () => {
    it('escenario 1: la primera habitación pasa a CHECKED_IN y la reserva a IN_PROGRESS, en ese orden y en una sola transacción', async () => {
      logs();
      const { service, runs, lockByRef, saved } = serviceWith();

      await expect(service.execute(notification())).resolves.toBe('APPLIED');

      expect(runs).toHaveLength(1);
      expect(lockByRef).toHaveBeenCalledExactlyOnceWith('RSV-8D02E5A4', TX);
      // La reserva solo puede pasar a IN_PROGRESS con una habitación ya en CHECKED_IN.
      expect(saved()).toEqual([
        {
          status: 'ACTIVE',
          statusReason: null,
          stays: ['CHECKED_IN', 'EXPECTED'],
        },
        {
          status: 'IN_PROGRESS',
          statusReason: 'CHECK_IN',
          stays: ['CHECKED_IN', 'EXPECTED'],
        },
      ]);
    });

    it('escenario 2: otra habitación de una reserva IN_PROGRESS pasa a CHECKED_IN y la reserva sigue igual', async () => {
      logs();
      const { service, saved } = serviceWith({
        reservation: aReservation('IN_PROGRESS', {
          room201: 'CHECKED_IN',
          room202: 'EXPECTED',
        }),
      });

      await expect(
        service.execute(notification({ roomId: ROOM_202 })),
      ).resolves.toBe('APPLIED');

      expect(saved()).toEqual([
        {
          status: 'IN_PROGRESS',
          statusReason: null,
          stays: ['CHECKED_IN', 'CHECKED_IN'],
        },
      ]);
    });

    it('escenario 3 (T018): registra a los huéspedes con RegisterGuestMovements, como ENTRY con la fecha del mensaje, en la misma transacción', async () => {
      logs();
      const reservation = aReservation('ACTIVE');
      const { service, register } = serviceWith({ reservation });

      await service.execute(notification());

      expect(register).toHaveBeenCalledExactlyOnceWith(TX, {
        reservationId: reservation.id,
        roomId: ROOM_201,
        movementType: 'ENTRY',
        movementDate: '2026-10-09',
        guests: [ANA, JOHN],
      });
    });

    it('registra el messageId con su cola y su sequenceNumber, después del cambio y de los huéspedes', async () => {
      logs();
      const { service, update, register, record } = serviceWith();

      await service.execute(notification());

      expect(record).toHaveBeenCalledExactlyOnceWith(
        { messageId: MESSAGE_ID, queue: QUEUE, sequenceNumber: 123 },
        TX,
      );
      expect(record.mock.invocationCallOrder[0]).toBeGreaterThan(
        register.mock.invocationCallOrder[0],
      );
      expect(register.mock.invocationCallOrder[0]).toBeGreaterThan(
        update.mock.invocationCallOrder[1],
      );
    });

    it('deja en el log el resumen del registro, solo con cifras', async () => {
      const { log } = logs();
      const { service } = serviceWith();

      await service.execute(notification());

      expect(log).toHaveBeenCalledExactlyOnceWith(
        `Check-In aplicado (reserva RSV-8D02E5A4, habitación ${ROOM_201}): 2 huéspedes recibidos, 2 registrados, 0 ya registrados, 1 extranjeros y 0 omitidos.`,
      );
    });

    it('un Check-In anticipado o con huéspedes de más se procesa igual: no revisa fechas ni cantidades', async () => {
      logs();
      const { service } = serviceWith();

      await expect(
        service.execute(
          notification({
            movementDate: '2026-01-01',
            guests: [ANA, JOHN, { ...JOHN, documentNumber: 'X100' }],
          }),
        ),
      ).resolves.toBe('APPLIED');
    });
  });

  describe('los duplicados: se confirman sin efectos', () => {
    it('escenario 4 y FR-023: el mismo messageId no cambia nada, ni registra, ni revisa la secuencia', async () => {
      logs();
      const { service, update, register, record, highestSequenceNumber } =
        serviceWith({ processed: [MESSAGE_ID] });

      await expect(service.execute(notification())).resolves.toBe('DUPLICATE');

      expect(update).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(highestSequenceNumber).not.toHaveBeenCalled();
    });

    it('escenario 4 y punto 6: la habitación ya en CHECKED_IN, con otro messageId, no cambia la reserva y registra el mensaje con su sequenceNumber', async () => {
      logs();
      const { service, update, register, recorded } = serviceWith({
        reservation: aReservation('IN_PROGRESS', {
          room201: 'CHECKED_IN',
          room202: 'EXPECTED',
        }),
      });

      await expect(service.execute(notification())).resolves.toBe('DUPLICATE');

      expect(update).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(recorded).toEqual([
        { messageId: MESSAGE_ID, queue: QUEUE, sequenceNumber: 123 },
      ]);
    });

    it('el messageId repetido gana aunque la reserva ya no exista (verificación 1 antes que la 2)', async () => {
      const { warn } = logs();
      const { service } = serviceWith({
        reservation: null,
        processed: [MESSAGE_ID],
      });

      await expect(service.execute(notification())).resolves.toBe('DUPLICATE');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('los rechazos: no cambian nada, quedan en el log y registran el mensaje (punto 6)', () => {
    /** Revisa que no cambió nada, que registró el mensaje y que dejó ese motivo en el log. */
    async function expectRejected(
      setup: Parameters<typeof serviceWith>[0],
      reason: string,
      changes: Partial<CheckInNotification> = {},
    ) {
      const { warn } = logs();
      const { service, update, register, recorded } = serviceWith(setup);

      await expect(service.execute(notification(changes))).resolves.toBe(
        'REJECTED',
      );

      expect(update).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(recorded).toEqual([
        {
          messageId: MESSAGE_ID,
          queue: QUEUE,
          sequenceNumber: 123,
        },
      ]);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Check-In rechazado (reserva RSV-8D02E5A4, habitación ${changes.roomId ?? ROOM_201}): ${reason}`,
      );
    }

    it('la reserva no existe', async () => {
      await expectRejected(
        { reservation: null },
        'La reserva notificada no existe en el sistema de reservas.',
      );
    });

    it('escenario 6: la habitación no pertenece a la reserva', async () => {
      await expectRejected(
        {},
        'La habitación notificada no pertenece a la reserva.',
        { roomId: 'd0d0d0d0-0000-4000-8000-000000000004' },
      );
    });

    it.each([
      ['PENDING', 'EXPECTED'],
      ['COMPLETED', 'CHECKED_OUT'],
      ['CANCELLED', 'EXPECTED'],
      ['NO_SHOW', 'NOT_ARRIVED'],
    ] as const)(
      'escenario 5: la reserva en %s no admite un Check-In',
      async (status, stay) => {
        await expectRejected(
          {
            reservation: aReservation(status, { room201: stay, room202: stay }),
          },
          `La reserva no admite un Check-In en su estado actual. Está en ${status}.`,
        );
      },
    );

    it.each(['NOT_ARRIVED', 'CHECKED_OUT'] as const)(
      'la habitación en %s no admite un Check-In aunque la reserva siga IN_PROGRESS',
      async (stay) => {
        await expectRejected(
          {
            reservation: aReservation('IN_PROGRESS', {
              room201: stay,
              room202: 'CHECKED_IN',
            }),
          },
          `La habitación notificada no admite un Check-In: está en ${stay}.`,
        );
      },
    );

    it('la habitación ajena gana sobre el estado de la reserva (verificación 3 antes que la 5)', async () => {
      await expectRejected(
        { reservation: aReservation('CANCELLED') },
        'La habitación notificada no pertenece a la reserva.',
        { roomId: 'd0d0d0d0-0000-4000-8000-000000000004' },
      );
    });
  });

  describe('FR-023: el salto de secuencia', () => {
    it.each([
      [120, 'se esperaba el 121 y llegó el 123'],
      [0, 'se esperaba el 1 y llegó el 123'],
    ])(
      'con el mayor anterior en %i, lo advierte y sigue procesando',
      async (highestSequence, detail) => {
        const { warn } = logs();
        const { service, highestSequenceNumber } = serviceWith({
          highestSequence,
        });

        await expect(service.execute(notification())).resolves.toBe('APPLIED');

        expect(highestSequenceNumber).toHaveBeenCalledExactlyOnceWith(
          QUEUE,
          TX,
        );
        expect(warn).toHaveBeenCalledExactlyOnceWith(
          `Salto de secuencia en ${QUEUE}: ${detail}. Se sigue procesando.`,
        );
      },
    );

    it.each([
      ['el siguiente', 122],
      ['uno anterior', 130],
      ['el mismo número', 123],
      ['el primero de la cola', null],
    ])('%s no es un salto', async (_case, highestSequence) => {
      const { warn } = logs();
      const { service } = serviceWith({ highestSequence });

      await service.execute(notification());

      expect(warn).not.toHaveBeenCalled();
    });

    it('también lo advierte cuando la notificación se rechaza', async () => {
      const { warn } = logs();
      const { service } = serviceWith({
        reservation: null,
        highestSequence: 100,
      });

      await expect(service.execute(notification())).resolves.toBe('REJECTED');

      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toContain('Salto de secuencia');
    });
  });

  it('un fallo temporal sale como error y no registra el mensaje: la transacción se revierte y el consumidor reintenta', async () => {
    logs();
    const { service, register, record } = serviceWith();
    register.mockRejectedValue(new Error('la base de datos no responde'));

    await expect(service.execute(notification())).rejects.toThrow(
      'la base de datos no responde',
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('ningún log escribe datos personales de los huéspedes', async () => {
    const { warn, log } = logs();
    // Una secuencia que no se confunda con el documento de Ana (`123`).
    const changes = { sequenceNumber: 9001 };

    await serviceWith({ highestSequence: 1 }).service.execute(
      notification(changes),
    );
    await serviceWith({
      reservation: null,
      highestSequence: null,
    }).service.execute(notification(changes));

    const written = [...warn.mock.calls, ...log.mock.calls].flat().join('\n');
    expect(written).toContain('Salto de secuencia');
    expect(written).toContain('Check-In aplicado');
    expect(written).toContain('Check-In rechazado');
    for (const value of [
      'Ana',
      'Pérez',
      '123',
      '1995-03-20',
      'John',
      'Smith',
      'X99',
      '1990-05-12',
    ]) {
      expect(written).not.toContain(value);
    }
  });
});
