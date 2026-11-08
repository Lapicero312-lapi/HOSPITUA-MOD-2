import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DuplicateCancellationError,
  type CancellationRepository,
} from '../../../../../src/application/ports/out/cancellation.repository.js';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import { CancelReservationService } from '../../../../../src/application/use-cases/cancel-reservation/cancel-reservation.service.js';
import type { CancelReservationCommand } from '../../../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import type { DailyListChangeRecorder } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import type { ReservationLookup } from '../../../../../src/application/use-cases/check-view-reservation/ports/in/reservation-lookup.port.js';
import type { ReservationStatusPort } from '../../../../../src/application/use-cases/update-reservation/ports/in/reservation-status.port.js';
import type { Cancellation } from '../../../../../src/domain/cancellation/cancellation.js';
import type {
  Reservation,
  ReservationProps,
} from '../../../../../src/domain/reservation/reservation.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';
import type {
  ReservationStatus,
  StatusReason,
} from '../../../../../src/domain/shared/enums.js';
import {
  aDirectReservation,
  anOtaReservation,
} from '../../../../support/builders.js';

const TX = { tx: 'la transacción de quien llama' } as unknown as Transaction;
const NOW = new Date('2026-10-09T15:15:20.000Z');
const CLOCK: Clock = { today: () => '2026-10-09', now: () => NOW };

/** El `updatedAt` como lo entrega la base, y el mismo instante como lo envía la pantalla. */
const UPDATED_AT_FROM_DATABASE = '2026-10-08 15:42:10.123456-05';
const UPDATED_AT_FROM_SCREEN = '2026-10-08T15:42:10.123456-05:00';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const directReservation = (changes: Partial<ReservationProps> = {}) =>
  aDirectReservation({ updatedAt: UPDATED_AT_FROM_DATABASE, ...changes });

const otaReservation = (changes: Partial<ReservationProps> = {}) =>
  anOtaReservation(randomUUID(), {
    updatedAt: UPDATED_AT_FROM_DATABASE,
    ...changes,
  });

/** La cancelación de la Recepcionista del contrato A. */
const fromReception = (
  reservation: Reservation,
  changes: Partial<CancelReservationCommand> = {},
): CancelReservationCommand => ({
  reservationRef: reservation.reservationRef,
  channel: 'RECEPTION',
  processedBy: 'laura.mendez',
  reason: 'El huésped cambió de planes',
  acknowledged: true,
  expectedUpdatedAt: UPDATED_AT_FROM_SCREEN,
  ...changes,
});

/** La cancelación de Booking del contrato B: sin `acknowledged` ni `updatedAt`. */
const fromBooking = (reservation: Reservation): CancelReservationCommand => ({
  reservationRef: reservation.reservationRef,
  channel: 'OTA_API',
  processedBy: 'Booking.com',
  reason: null,
});

/** El servicio con los puertos simulados; `stored` es la reserva que encuentra `findForUpdate`. */
function serviceWith(
  stored: Reservation | null,
  insert: CancellationRepository['insert'] = () => Promise.resolve(),
) {
  const calls: string[] = [];
  const findForUpdate = vi.fn((_tx: Transaction, _ref: string) => {
    calls.push('findForUpdate');
    return Promise.resolve(stored);
  });
  const transition = vi.fn(
    (
      _tx: Transaction,
      reservation: Reservation,
      target: ReservationStatus,
      reason: StatusReason,
    ) => {
      calls.push('transition');
      return Promise.resolve(reservation.withStatus(target, reason));
    },
  );
  const insertCancellation = vi.fn(
    (cancellation: Cancellation, tx: Transaction) => {
      calls.push('insert');
      return insert(cancellation, tx);
    },
  );
  const record = vi.fn(
    (_tx: Transaction, _before: Reservation | null, _after: Reservation) => {
      calls.push('record');
      return Promise.resolve();
    },
  );
  const service = new CancelReservationService(
    { findForUpdate } as unknown as ReservationLookup,
    { transition } as unknown as ReservationStatusPort,
    { insert: insertCancellation } as CancellationRepository,
    { record } as DailyListChangeRecorder,
    CLOCK,
    // `execute` abre su transacción; `cancel` recibe la de quien llama.
    { run: (work) => work(TX) },
  );
  /** La reserva que devolvió `transition`: la ya guardada. */
  const cancelled = () =>
    transition.mock.results[0]?.value as Promise<Reservation>;
  return {
    service,
    calls,
    cancelled,
    findForUpdate,
    transition,
    insertCancellation,
    record,
  };
}

/** Lanza un `BusinessError` con ese código. */
async function expectBusinessError(
  promise: Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BusinessError);
  expect(error).toMatchObject({ errorCode: code, message });
}

describe('CancelReservation: la cancelación que se aplica (T005 a T007)', () => {
  it('escenario 1: la Recepcionista cancela una directa; bloquea, pasa a CANCELLED, guarda la Cancellation y anota la lista del día, en ese orden y en la misma transacción', async () => {
    const reservation = directReservation();
    const {
      service,
      calls,
      cancelled,
      findForUpdate,
      transition,
      insertCancellation,
      record,
    } = serviceWith(reservation);

    const result = await service.cancel(TX, fromReception(reservation));

    const saved = await cancelled();
    expect(result).toBe(saved);
    expect(saved.status).toBe('CANCELLED');
    expect(calls).toEqual(['findForUpdate', 'transition', 'insert', 'record']);
    expect(findForUpdate).toHaveBeenCalledWith(TX, reservation.reservationRef);
    expect(transition).toHaveBeenCalledWith(
      TX,
      reservation,
      'CANCELLED',
      'CANCELLED_BY_RECEPTION',
    );
    const [cancellation, cancellationTx] = insertCancellation.mock.calls[0];
    expect(cancellationTx).toBe(TX);
    expect(cancellation.snapshot()).toEqual({
      id: expect.stringMatching(UUID),
      reservationRef: reservation.reservationRef,
      cancellationDate: NOW,
      reason: 'El huésped cambió de planes',
      channel: 'RECEPTION',
      processedBy: 'laura.mendez',
      status: 'COMPLETED',
    });
    // La lista del día recibe la reserva de antes y la ya guardada (REMOVED si estaba en la lista).
    expect(record).toHaveBeenCalledWith(TX, reservation, saved);
  });

  it('escenario 2: Booking cancela la suya sin acknowledged ni updatedAt; motivo CANCELLED_BY_OTA y processedBy Booking.com', async () => {
    const reservation = otaReservation();
    const { service, transition, insertCancellation, record } =
      serviceWith(reservation);

    await service.cancel(TX, fromBooking(reservation));

    expect(transition).toHaveBeenCalledWith(
      TX,
      reservation,
      'CANCELLED',
      'CANCELLED_BY_OTA',
    );
    expect(insertCancellation.mock.calls[0][0].snapshot()).toMatchObject({
      reason: null,
      channel: 'OTA_API',
      processedBy: 'Booking.com',
    });
    expect(record).toHaveBeenCalledOnce();
  });

  it.each<ReservationStatus>(['ACTIVE', 'PENDING'])(
    'una directa en %s se cancela',
    async (status) => {
      const reservation = directReservation({ status });
      const { service, transition } = serviceWith(reservation);

      await service.cancel(TX, fromReception(reservation));

      expect(transition).toHaveBeenCalledOnce();
    },
  );

  it('sin motivo, la Cancellation lo guarda como null', async () => {
    const reservation = directReservation();
    const { service, insertCancellation } = serviceWith(reservation);

    await service.cancel(TX, fromReception(reservation, { reason: null }));

    expect(insertCancellation.mock.calls[0][0].reason).toBeNull();
  });

  it('cada cancelación lleva su propio cancellationId', async () => {
    const first = serviceWith(directReservation());
    const second = serviceWith(directReservation());

    await first.service.cancel(TX, fromReception(directReservation()));
    await second.service.cancel(TX, fromReception(directReservation()));

    expect(first.insertCancellation.mock.calls[0][0].id).not.toBe(
      second.insertCancellation.mock.calls[0][0].id,
    );
  });
});

describe('CancelReservation: las verificaciones de la regla 3, en orden', () => {
  it.each([
    [
      'vacía',
      '',
      'RESERVATION_REF_REQUIRED',
      'La referencia de la reserva es obligatoria.',
    ],
    [
      'solo con espacios',
      '   ',
      'RESERVATION_REF_REQUIRED',
      'La referencia de la reserva es obligatoria.',
    ],
    [
      'sin el formato',
      'RSV-3f9a1c7b',
      'INVALID_RESERVATION_CODE',
      'Debe proveer un código de reserva válido para la consulta.',
    ],
  ])(
    'paso 1: la referencia %s se rechaza antes de consultar la base',
    async (_case, reservationRef, code, message) => {
      const reservation = directReservation();
      const { service, findForUpdate } = serviceWith(reservation);

      await expectBusinessError(
        service.cancel(TX, fromReception(reservation, { reservationRef })),
        code,
        message,
      );
      expect(findForUpdate).not.toHaveBeenCalled();
    },
  );

  it('paso 1: el motivo de más de 500 caracteres se rechaza antes de consultar la base', async () => {
    const reservation = directReservation();
    const { service, findForUpdate } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, { reason: 'a'.repeat(501) }),
      ),
      'REASON_TOO_LONG',
      'El motivo no puede superar 500 caracteres.',
    );
    expect(findForUpdate).not.toHaveBeenCalled();
  });

  it('paso 1 también en B: Booking con una referencia inválida no llega a la base', async () => {
    const reservation = otaReservation();
    const { service, findForUpdate } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(TX, { ...fromBooking(reservation), reservationRef: '' }),
      'RESERVATION_REF_REQUIRED',
      'La referencia de la reserva es obligatoria.',
    );
    expect(findForUpdate).not.toHaveBeenCalled();
  });

  it('paso 2: la reserva que no existe da RESERVATION_NOT_FOUND', async () => {
    const { service, transition } = serviceWith(null);

    await expectBusinessError(
      service.cancel(TX, fromReception(directReservation())),
      'RESERVATION_NOT_FOUND',
      'La reserva no existe.',
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it('escenario 6, paso 2: la Recepcionista sobre una de OTA da OTA_RESERVATION_CANCEL_VIA_API y no registra nada', async () => {
    const reservation = otaReservation();
    const { service, transition, insertCancellation, record } =
      serviceWith(reservation);

    await expectBusinessError(
      service.cancel(TX, fromReception(reservation)),
      'OTA_RESERVATION_CANCEL_VIA_API',
      'La cancelación de una reserva de OTA debe llegar desde Booking.',
    );
    expect(transition).not.toHaveBeenCalled();
    expect(insertCancellation).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('paso 2 antes del 3: sobre una de OTA, aun sin acknowledged, el error es el del canal', async () => {
    const reservation = otaReservation();
    const { service } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, { acknowledged: undefined }),
      ),
      'OTA_RESERVATION_CANCEL_VIA_API',
      'La cancelación de una reserva de OTA debe llegar desde Booking.',
    );
  });

  it('paso 2: Booking sobre una directa es un error del programa, no de negocio (REQUEST_NOT_PROCESSED)', async () => {
    const reservation = directReservation();
    const { service, transition } = serviceWith(reservation);

    const error: unknown = await service
      .cancel(TX, fromBooking(reservation))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BusinessError);
    expect(transition).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', undefined],
    ['false', false],
  ])(
    'paso 3: la Recepcionista con acknowledged %s da CANCELLATION_NOT_CONFIRMED',
    async (_case, acknowledged) => {
      const reservation = directReservation();
      const { service, transition } = serviceWith(reservation);

      await expectBusinessError(
        service.cancel(TX, fromReception(reservation, { acknowledged })),
        'CANCELLATION_NOT_CONFIRMED',
        'Debe confirmar que entiende que la cancelación no se puede deshacer.',
      );
      expect(transition).not.toHaveBeenCalled();
    },
  );

  it('paso 3 antes del 4: sin acknowledged y con otro updatedAt, el error es el de la confirmación', async () => {
    const reservation = directReservation();
    const { service } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, {
          acknowledged: false,
          expectedUpdatedAt: '2026-10-08T15:42:10.000001-05:00',
        }),
      ),
      'CANCELLATION_NOT_CONFIRMED',
      'Debe confirmar que entiende que la cancelación no se puede deshacer.',
    );
  });

  it('paso 4: otro updatedAt da CONCURRENT_UPDATE con el mensaje del spec', async () => {
    const reservation = directReservation();
    const { service, transition } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, {
          expectedUpdatedAt: '2026-10-08T15:42:10.123457-05:00',
        }),
      ),
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it('paso 4: un updatedAt que no es una fecha da CONCURRENT_UPDATE', async () => {
    const reservation = directReservation();
    const { service } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, { expectedUpdatedAt: 'ayer' }),
      ),
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
  });

  it('paso 4: el mismo instante escrito como lo entrega la base también coincide', async () => {
    const reservation = directReservation();
    const { service, transition } = serviceWith(reservation);

    await service.cancel(
      TX,
      fromReception(reservation, {
        expectedUpdatedAt: UPDATED_AT_FROM_DATABASE,
      }),
    );

    expect(transition).toHaveBeenCalledOnce();
  });

  it('D2, paso 4 antes del 5: la segunda de dos cancelaciones encuentra la reserva ya CANCELLED y recibe CONCURRENT_UPDATE, no el error del estado', async () => {
    const reservation = directReservation({
      status: 'CANCELLED',
      statusReason: 'CANCELLED_BY_RECEPTION',
      updatedAt: '2026-10-09 10:15:20.654321-05',
    });
    const { service } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(TX, fromReception(reservation)),
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
  });

  it.each<ReservationStatus>([
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ])(
    'escenario 4, paso 5: una directa en %s da STATUS_NOT_CANCELLABLE y no registra nada',
    async (status) => {
      const reservation = directReservation({ status });
      const { service, transition, insertCancellation, record } =
        serviceWith(reservation);

      await expectBusinessError(
        service.cancel(TX, fromReception(reservation)),
        'STATUS_NOT_CANCELLABLE',
        'El estado actual de la reserva no admite cancelación.',
      );
      expect(transition).not.toHaveBeenCalled();
      expect(insertCancellation).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );
});

describe('CancelReservation: la Cancellation que la restricción única rechaza', () => {
  it('D2: si la reserva ya tiene su Cancellation, da CONCURRENT_UPDATE y no anota la lista del día', async () => {
    const reservation = directReservation();
    const { service, record } = serviceWith(reservation, () =>
      Promise.reject(
        new DuplicateCancellationError(reservation.reservationRef),
      ),
    );

    await expectBusinessError(
      service.cancel(TX, fromReception(reservation)),
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('cualquier otro error al guardarla sale tal cual: la transacción se revierte', async () => {
    const failure = new Error('se cayó la conexión');
    const reservation = directReservation();
    const { service, record } = serviceWith(reservation, () =>
      Promise.reject(failure),
    );

    await expect(service.cancel(TX, fromReception(reservation))).rejects.toBe(
      failure,
    );
    expect(record).not.toHaveBeenCalled();
  });
});

describe('CancelReservation.execute: la cancelación de la Recepcionista en su propia transacción (T008, A y D1)', () => {
  it('escenario 1: abre la transacción, cancela y responde lo del contrato A, con la fecha en hora de Colombia', async () => {
    const reservation = directReservation();
    const { service, findForUpdate, insertCancellation } =
      serviceWith(reservation);

    const result = await service.execute(fromReception(reservation));

    // La misma transacción para todo: la que abrió `execute`.
    expect(findForUpdate).toHaveBeenCalledWith(TX, reservation.reservationRef);
    const [cancellation] = insertCancellation.mock.calls[0];
    expect(result).toEqual({
      reservationRef: reservation.reservationRef,
      status: 'CANCELLED',
      cancellation: {
        cancellationId: cancellation.id,
        // NOW es 2026-10-09T15:15:20Z: las 10:15:20 en Colombia.
        cancellationDate: '2026-10-09T10:15:20-05:00',
        channel: 'RECEPTION',
        reason: 'El huésped cambió de planes',
        processedBy: 'laura.mendez',
        status: 'COMPLETED',
      },
    });
  });

  it('sin motivo responde reason null', async () => {
    const reservation = directReservation();
    const { service } = serviceWith(reservation);

    const result = await service.execute(
      fromReception(reservation, { reason: null }),
    );

    expect(result.cancellation.reason).toBeNull();
  });

  it('si una verificación falla, el error sale tal cual y no se registra nada', async () => {
    const reservation = directReservation({ status: 'IN_PROGRESS' });
    const { service, insertCancellation, record } = serviceWith(reservation);

    await expectBusinessError(
      service.execute(fromReception(reservation)),
      'STATUS_NOT_CANCELLABLE',
      'El estado actual de la reserva no admite cancelación.',
    );
    expect(insertCancellation).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('CancelReservation: el updatedAt es obligatorio para la Recepcionista (contrato A)', () => {
  it('paso 4: sin updatedAt, la Recepcionista recibe CONCURRENT_UPDATE y no se cancela', async () => {
    const reservation = directReservation();
    const { service, transition } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, { expectedUpdatedAt: undefined }),
      ),
      'CONCURRENT_UPDATE',
      'Esta reserva ya fue actualizada o cancelada recientemente',
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it('paso 3 antes del 4: sin acknowledged ni updatedAt, el error es el de la confirmación', async () => {
    const reservation = directReservation();
    const { service } = serviceWith(reservation);

    await expectBusinessError(
      service.cancel(
        TX,
        fromReception(reservation, {
          acknowledged: false,
          expectedUpdatedAt: undefined,
        }),
      ),
      'CANCELLATION_NOT_CONFIRMED',
      'Debe confirmar que entiende que la cancelación no se puede deshacer.',
    );
  });

  it('Booking sigue sin necesitar updatedAt (contrato B)', async () => {
    const reservation = otaReservation();
    const { service } = serviceWith(reservation);

    await expect(
      service.cancel(TX, fromBooking(reservation)),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
  });
});
