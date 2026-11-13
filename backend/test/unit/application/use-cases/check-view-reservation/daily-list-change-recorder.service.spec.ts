import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type {
  DailyMessage,
  DailyMessageRepository,
} from '../../../../../src/application/ports/out/daily-message.repository.js';
import type {
  DailySequence,
  DailySequenceRepository,
} from '../../../../../src/application/ports/out/daily-sequence.repository.js';
import type { OtaRepository } from '../../../../../src/application/ports/out/ota.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import { DailyListChangeRecorderService } from '../../../../../src/application/use-cases/check-view-reservation/daily-list-change-recorder.service.js';
import type { Ota } from '../../../../../src/domain/ota/ota.js';
import type { ReservationProps } from '../../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
  aGuest,
  anOta,
  anOtaRoom,
  otaTerms,
} from '../../../../support/builders.js';
import type { TransactionRunner } from '../../../../../src/application/ports/out/transaction.js';

/** El día operativo y la hora del ejemplo de UPDATED del plan: 2026-10-09 a las 09:15 de Colombia. */
const TODAY = '2026-10-09';
const NOW = new Date('2026-10-09T14:15:00.000Z');
const TX = { id: 'tx' } as unknown as Transaction;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ROOM_ID = '6f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const GUEST_REF = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/**
 * La reserva del ejemplo de la lista del día del plan (`RSV-3F9A1C7B`, la 201 `DOBLE` con 2 personas y la
 * titular Ana Pérez), guardada y con llegada hoy.
 */
function planReservation(changes: Partial<ReservationProps> = {}) {
  return aDirectReservation({
    id: 'b3c1f0d2-7a4e-4f6b-9c8d-1e2f3a4b5c6d',
    reservationRef: 'RSV-3F9A1C7B',
    startDate: TODAY,
    endDate: '2026-10-12',
    status: 'ACTIVE',
    notes: 'Llegada tarde',
    createdAt: new Date('2026-10-01T15:00:00.000Z'),
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
    ...changes,
  });
}

/** El detalle de FR-014 de la reserva del ejemplo, como viaja en el mensaje. */
const planDetail = {
  reservationRef: 'RSV-3F9A1C7B',
  status: 'ACTIVE',
  source: 'DIRECTA',
  startDate: TODAY,
  endDate: '2026-10-12',
  guestCount: 2,
  notes: 'Llegada tarde',
  updatedAt: '2026-10-08T15:42:10.123456-05:00',
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
};

/**
 * El recorder con la fila del día que devuelve `lockOrCreateDay` (por defecto, la lista ya salió y la
 * última secuencia es la 1) y las agencias guardadas. Devuelve también los dobles.
 */
function recorderWith(
  day: DailySequence = { lastSequence: 1, listGenerated: true },
  otas: Ota[] = [],
  clock: Clock = { today: () => TODAY, now: () => NOW },
) {
  const sequences = {
    lockOrCreateDay: vi.fn((_date: string, _tx: Transaction) =>
      Promise.resolve(day),
    ),
    setLastSequence: vi.fn((_date: string, _last: number, _tx: Transaction) =>
      Promise.resolve(),
    ),
  };
  const messages = {
    insert: vi.fn((_message: DailyMessage, _tx: Transaction) =>
      Promise.resolve(),
    ),
  };
  const otaRepository = {
    findById: vi.fn((id: string, _tx?: Transaction) =>
      Promise.resolve(otas.find((ota) => ota.id === id) ?? null),
    ),
  };
  const afterCommit = vi.fn<TransactionRunner['afterCommit']>();
  const publication = { execute: vi.fn(() => Promise.resolve(0)) };
  const recorder = new DailyListChangeRecorderService(
    sequences as unknown as DailySequenceRepository,
    messages as unknown as DailyMessageRepository,
    otaRepository as unknown as OtaRepository,
    clock,
    { afterCommit } as unknown as TransactionRunner,
    publication,
  );
  return {
    recorder,
    sequences,
    messages,
    otaRepository,
    afterCommit,
    publication,
  };
}

/** El único mensaje que se guardó. */
function onlyMessage(messages: {
  insert: { mock: { calls: [DailyMessage, Transaction][] } };
}): DailyMessage {
  expect(messages.insert.mock.calls).toHaveLength(1);
  return messages.insert.mock.calls[0][0];
}

describe('DailyListChangeRecorder (plan, "Anotar un cambio" y D3)', () => {
  describe('cuándo no deja nada', () => {
    it.each([
      [
        'la lista del día no ha salido',
        { lastSequence: 0, listGenerated: false },
      ],
    ])(
      'si %s, no deja mensaje ni toma secuencia: la lista incluirá el cambio',
      async (_, day) => {
        const { recorder, sequences, messages } = recorderWith(day);

        await recorder.record(TX, null, planReservation());

        expect(sequences.setLastSequence).not.toHaveBeenCalled();
        expect(messages.insert).not.toHaveBeenCalled();
      },
    );

    it('escenario 8: una reserva con llegada en una semana no genera mensaje', async () => {
      const { recorder, sequences, messages } = recorderWith();

      await recorder.record(
        TX,
        null,
        planReservation({ startDate: '2026-10-16', endDate: '2026-10-18' }),
      );

      expect(sequences.setLastSequence).not.toHaveBeenCalled();
      expect(messages.insert).not.toHaveBeenCalled();
    });

    it('un cambio que no toca ningún campo de FR-014 no genera mensaje', async () => {
      const { recorder, messages } = recorderWith();

      await recorder.record(TX, planReservation(), planReservation());

      expect(messages.insert).not.toHaveBeenCalled();
    });
  });

  describe('ADDED y UPDATED', () => {
    it('escenario 1: una reserva directa nueva para hoy deja el ADDED con la secuencia 2 y el detalle de FR-014', async () => {
      const { recorder, sequences, messages } = recorderWith();
      const after = planReservation();

      await recorder.record(TX, null, after);

      expect(sequences.setLastSequence).toHaveBeenCalledWith(TODAY, 2, TX);
      const message = onlyMessage(messages);
      expect(message.messageId).toMatch(UUID_V4);
      expect(message).toEqual({
        messageId: message.messageId,
        operationalDate: TODAY,
        sequenceNumber: 2,
        kind: 'UPDATE',
        updateType: 'ADDED',
        reservationId: after.id,
        removalReason: null,
        payload: {
          messageId: message.messageId,
          sequenceNumber: 2,
          operationalDate: TODAY,
          updateType: 'ADDED',
          occurredAt: '2026-10-09T09:15:00-05:00',
          reservationRef: 'RSV-3F9A1C7B',
          reservation: planDetail,
        },
      });
    });

    it('el ejemplo de UPDATED del plan: la salida pasa al 13 y viaja el detalle completo y vigente', async () => {
      const { recorder, messages } = recorderWith();

      await recorder.record(
        TX,
        planReservation(),
        planReservation({
          endDate: '2026-10-13',
          updatedAt: '2026-10-09 14:15:00+00',
        }),
      );

      expect(onlyMessage(messages).payload).toMatchObject({
        updateType: 'UPDATED',
        occurredAt: '2026-10-09T09:15:00-05:00',
        reservation: {
          ...planDetail,
          endDate: '2026-10-13',
          updatedAt: '2026-10-09T09:15:00.000000-05:00',
        },
      });
    });

    it('toma la secuencia siguiente a la última del día', async () => {
      const { recorder, sequences, messages } = recorderWith({
        lastSequence: 7,
        listGenerated: true,
      });

      await recorder.record(TX, null, planReservation());

      expect(sequences.setLastSequence).toHaveBeenCalledWith(TODAY, 8, TX);
      expect(onlyMessage(messages)).toMatchObject({
        sequenceNumber: 8,
        payload: { sequenceNumber: 8 },
      });
    });

    it('cada mensaje lleva su propio messageId', async () => {
      const { recorder, messages } = recorderWith();

      await recorder.record(TX, null, planReservation());
      await recorder.record(TX, null, planReservation());

      const [first, second] = messages.insert.mock.calls.map(
        ([message]) => message.messageId,
      );
      expect(first).not.toBe(second);
    });

    it('escenario 2: una reserva de Booking viaja con BOOKING y su código, y la agencia se lee en la misma transacción', async () => {
      const ota = anOta({ name: 'Booking.com' });
      const { recorder, messages, otaRepository } = recorderWith(undefined, [
        ota,
      ]);
      const after = planReservation({
        source: 'OTA',
        rooms: [
          anOtaRoom({
            roomId: ROOM_ID,
            roomNumber: '201',
            categoryRoom: 'DOBLE',
            guestCount: 2,
          }),
        ],
        ota: otaTerms(ota.id, { externalConfirmationCode: '4417829013' }),
      });

      await recorder.record(TX, null, after);

      expect(otaRepository.findById).toHaveBeenCalledWith(ota.id, TX);
      expect(onlyMessage(messages).payload).toMatchObject({
        updateType: 'ADDED',
        reservation: {
          source: 'BOOKING',
          externalConfirmationCode: '4417829013',
        },
      });
    });

    it('una reserva de OTA cuya agencia no existe es un error del programa y no deja mensaje', async () => {
      const { recorder, sequences, messages } = recorderWith(undefined, []);
      const after = planReservation({
        source: 'OTA',
        rooms: [anOtaRoom({ roomId: ROOM_ID })],
        ota: otaTerms('9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'),
      });

      await expect(recorder.record(TX, null, after)).rejects.toThrow(
        'La agencia de la reserva RSV-3F9A1C7B no existe.',
      );
      expect(sequences.setLastSequence).not.toHaveBeenCalled();
      expect(messages.insert).not.toHaveBeenCalled();
    });
  });

  describe('REMOVED', () => {
    it('escenario 4: una reserva de la lista que se cancela deja el REMOVED con CANCELLED, sin la reserva', async () => {
      const { recorder, messages } = recorderWith();
      const after = planReservation({
        status: 'CANCELLED',
        statusReason: 'Cancelada por el huésped',
      });

      await recorder.record(TX, planReservation(), after);

      const message = onlyMessage(messages);
      expect(message).toMatchObject({
        kind: 'UPDATE',
        updateType: 'REMOVED',
        reservationId: after.id,
        removalReason: 'CANCELLED',
      });
      expect(message.payload).toEqual({
        messageId: message.messageId,
        sequenceNumber: 2,
        operationalDate: TODAY,
        updateType: 'REMOVED',
        occurredAt: '2026-10-09T09:15:00-05:00',
        reservationRef: 'RSV-3F9A1C7B',
        removalReason: 'CANCELLED',
      });
    });

    it('el ejemplo de NO_SHOW del plan: con el día que pasa el cierre, aunque corra a las 00:00:30 del siguiente', async () => {
      // El reloj ya está en el día siguiente: el día operativo del mensaje es el que pasa el cierre.
      const { recorder, sequences, messages } = recorderWith(
        { lastSequence: 2, listGenerated: true },
        [],
        {
          today: () => '2026-10-10',
          now: () => new Date('2026-10-10T05:00:30.000Z'),
        },
      );
      const before = planReservation({ reservationRef: 'RSV-8D02E5A4' });

      await recorder.record(
        TX,
        before,
        planReservation({ reservationRef: 'RSV-8D02E5A4', status: 'NO_SHOW' }),
        TODAY,
      );

      expect(sequences.lockOrCreateDay).toHaveBeenCalledWith(TODAY, TX);
      expect(sequences.setLastSequence).toHaveBeenCalledWith(TODAY, 3, TX);
      const message = onlyMessage(messages);
      expect(message.operationalDate).toBe(TODAY);
      expect(message.payload).toEqual({
        messageId: message.messageId,
        sequenceNumber: 3,
        operationalDate: TODAY,
        updateType: 'REMOVED',
        occurredAt: '2026-10-10T00:00:30-05:00',
        reservationRef: 'RSV-8D02E5A4',
        removalReason: 'NO_SHOW',
      });
    });

    it('una habitación de Booking que queda sin asignar saca la reserva con ROOM_UNASSIGNED', async () => {
      const { recorder, messages } = recorderWith();
      // Solo una reserva de OTA puede tener una habitación sin asignar (D13).
      const booking = (roomId: string | null) =>
        planReservation({
          source: 'OTA',
          rooms: [
            anOtaRoom({
              roomId,
              roomNumber: roomId === null ? null : '201',
            }),
          ],
          ota: otaTerms('9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a'),
        });

      await recorder.record(TX, booking(ROOM_ID), booking(null));

      expect(onlyMessage(messages)).toMatchObject({
        updateType: 'REMOVED',
        removalReason: 'ROOM_UNASSIGNED',
      });
    });
  });

  it('sin día operativo, usa el día en curso del reloj', async () => {
    const { recorder, sequences } = recorderWith();

    await recorder.record(TX, null, planReservation());

    expect(sequences.lockOrCreateDay).toHaveBeenCalledWith(TODAY, TX);
  });

  it('todo va en la transacción de quien llama', async () => {
    const { recorder, sequences, messages } = recorderWith();

    await recorder.record(TX, null, planReservation());

    expect(sequences.lockOrCreateDay.mock.calls[0][1]).toBe(TX);
    expect(sequences.setLastSequence.mock.calls[0][2]).toBe(TX);
    expect(messages.insert.mock.calls[0][1]).toBe(TX);
  });

  describe('la publicación inmediata (T029)', () => {
    it('al guardar un mensaje, deja la publicación para cuando se confirme la transacción', async () => {
      const { recorder, afterCommit, publication } = recorderWith();

      await recorder.record(TX, null, planReservation());

      expect(afterCommit).toHaveBeenCalledTimes(1);
      const [tx, work] = afterCommit.mock.calls[0];
      expect(tx).toBe(TX);
      // Todavía no publica: eso pasa después del COMMIT.
      expect(publication.execute).not.toHaveBeenCalled();
      await work();
      expect(publication.execute).toHaveBeenCalledTimes(1);
    });

    it('sin mensaje no deja ninguna publicación', async () => {
      const { recorder, afterCommit } = recorderWith();

      await recorder.record(
        TX,
        null,
        planReservation({ startDate: '2026-10-16', endDate: '2026-10-18' }),
      );

      expect(afterCommit).not.toHaveBeenCalled();
    });
  });
});
