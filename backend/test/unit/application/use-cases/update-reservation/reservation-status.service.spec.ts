import { describe, expect, it, vi } from 'vitest';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import { ReservationStatusService } from '../../../../../src/application/use-cases/update-reservation/reservation-status.service.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  aDirectRoom,
} from '../../../../support/builders.js';

const tx = {} as Transaction;

/** Un repositorio que devuelve lo que recibe y registra cada llamada. */
function fakeRepository() {
  const update = vi.fn((reservation: Reservation) =>
    Promise.resolve(reservation),
  );
  return { update, repository: { update } as unknown as ReservationRepository };
}

describe('ReservationStatusService', () => {
  it('transition guarda la reserva cambiada en la transacción de quien llama', async () => {
    const { update, repository } = fakeRepository();
    const reservation = aDirectReservation({
      rooms: [aDirectRoom({ stayStatus: 'CHECKED_IN' })],
    });

    const result = await new ReservationStatusService(repository).transition(
      tx,
      reservation,
      'IN_PROGRESS',
      'CHECK_IN',
    );

    expect(result.status).toBe('IN_PROGRESS');
    expect(update).toHaveBeenCalledWith(result, tx);
  });

  it('transitionStay guarda la reserva con la habitación cambiada', async () => {
    const { update, repository } = fakeRepository();
    const room = aDirectRoom();

    const result = await new ReservationStatusService(
      repository,
    ).transitionStay(
      tx,
      aDirectReservation({ rooms: [room] }),
      room.roomId!,
      'CHECKED_IN',
    );

    expect(result.rooms[0].stayStatus).toBe('CHECKED_IN');
    expect(update).toHaveBeenCalledWith(result, tx);
  });

  it('una transición no permitida no guarda nada', async () => {
    const { update, repository } = fakeRepository();

    await expect(
      new ReservationStatusService(repository).transition(
        tx,
        aDirectReservation({ status: 'CANCELLED' }),
        'ACTIVE',
        'CHECK_IN',
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_STATUS_TRANSITION' });
    expect(update).not.toHaveBeenCalled();
  });
});
