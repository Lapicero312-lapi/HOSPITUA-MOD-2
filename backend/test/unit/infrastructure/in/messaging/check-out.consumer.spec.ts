import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessCheckOut } from '../../../../../src/application/use-cases/update-reservation/ports/in/process-check-out.port.js';
import { CheckOutConsumer } from '../../../../../src/infrastructure/in/messaging/check-out.consumer.js';
import { ConsumesQueue } from '../../../../../src/infrastructure/in/messaging/inbound-consumer.js';
import { InvalidMessageError } from '../../../../../src/infrastructure/in/messaging/retry-or-dead-letter.js';

const ANA = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};

/** El mensaje de Check-Out del contrato A del plan de `update-reservation`. */
const CHECK_OUT = {
  messageId: '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f',
  sequenceNumber: 123,
  reservationRef: 'RSV-8D02E5A4',
  roomId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  movementType: 'DEPARTURE',
  movementDate: '2026-10-12',
  guests: [ANA],
};

function consumerWith(
  outcome: Promise<'APPLIED' | 'DUPLICATE' | 'REJECTED'> = Promise.resolve(
    'APPLIED',
  ),
) {
  const execute = vi.fn<ProcessCheckOut['execute']>().mockReturnValue(outcome);
  return { consumer: new CheckOutConsumer({ execute }), execute };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CheckOutConsumer (plan de update-reservation, D4)', () => {
  it('consume m2.habitacion.checkout.queue', () => {
    expect(Reflect.getMetadata(ConsumesQueue.KEY, CheckOutConsumer)).toBe(
      'm2.habitacion.checkout.queue',
    );
  });

  it('pasa la notificación revisada a ProcessCheckOut, con su cola', async () => {
    const { consumer, execute } = consumerWith();

    await consumer.handle(CHECK_OUT);

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      messageId: CHECK_OUT.messageId,
      sequenceNumber: 123,
      queue: 'm2.habitacion.checkout.queue',
      reservationRef: 'RSV-8D02E5A4',
      roomId: CHECK_OUT.roomId,
      movementDate: '2026-10-12',
      guests: [ANA],
    });
  });

  it.each(['APPLIED', 'DUPLICATE', 'REJECTED'] as const)(
    'termina sin error cuando ProcessCheckOut responde %s: el mensaje se confirma',
    async (outcome) => {
      const { consumer } = consumerWith(Promise.resolve(outcome));

      await expect(consumer.handle(CHECK_OUT)).resolves.toBeUndefined();
    },
  );

  it('un mensaje inutilizable deja su motivo en el log y va a la dead-letter, sin procesar', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { consumer, execute } = consumerWith();
    const { reservationRef: _ref, ...withoutRef } = CHECK_OUT;

    await expect(consumer.handle(withoutRef)).rejects.toBeInstanceOf(
      InvalidMessageError,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Check-Out a la dead-letter: El payload de notificación es inválido. Falta el identificador de la reserva o de la habitación.',
    );
  });

  it('el log del rechazo no lleva los datos de los huéspedes', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { consumer } = consumerWith();

    await expect(
      consumer.handle({
        ...CHECK_OUT,
        guests: [{ ...ANA, lastName: '<Pérez>' }],
      }),
    ).rejects.toThrow('Caracteres no válidos en los datos de los huéspedes.');

    const written = warn.mock.calls.flat().join('\n');
    for (const value of ['Ana', 'Pérez', '1995-03-20', 'RSV-8D02E5A4']) {
      expect(written).not.toContain(value);
    }
  });

  it('un fallo temporal de ProcessCheckOut sale tal cual, sin pasar por la dead-letter: se reintenta', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const failure = new Error('la base de datos no responde');
    const { consumer } = consumerWith(Promise.reject(failure));

    await expect(consumer.handle(CHECK_OUT)).rejects.toBe(failure);
    expect(warn).not.toHaveBeenCalled();
  });
});
