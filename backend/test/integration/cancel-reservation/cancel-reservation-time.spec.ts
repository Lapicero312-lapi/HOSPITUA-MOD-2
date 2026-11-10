import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { colombiaTimeWithMicroseconds } from '../../../src/application/use-cases/check-view-reservation/message-time.js';
import type { CancelReservationCommand } from '../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import type { Reservation } from '../../../src/domain/reservation/reservation.js';
import { aDirectRoom, anOtaRoom } from '../../support/builders.js';
import {
  CancellationApp,
  REASON,
  RECEPTIONIST,
} from '../support/cancel-reservation.js';

const LIMIT_MS = 200;

/** La cancelación de la Recepcionista (A), como la arma la ruta con el cuerpo de la pantalla. */
const fromReception = (reservation: Reservation): CancelReservationCommand => ({
  reservationRef: reservation.reservationRef,
  channel: 'RECEPTION',
  processedBy: RECEPTIONIST,
  reason: REASON,
  acknowledged: true,
  expectedUpdatedAt: colombiaTimeWithMicroseconds(
    reservation.updatedAt as string,
  ),
});

async function timed<T>(
  action: () => Promise<T>,
): Promise<{ result: T; elapsed: number }> {
  const start = performance.now();
  const result = await action();
  return { result, elapsed: performance.now() - start };
}

/**
 * T014 de `cancel-reservation`, NFR-001: "El procesamiento local de la cancelación debe completarse en menos
 * de 200 milisegundos, sin contar la respuesta del Módulo 1". La cancelación no llama a ningún otro módulo
 * (plan, "Integraciones externas"): lo que se mide es todo su procesamiento con PostgreSQL real, por cada
 * canal: las verificaciones, el bloqueo de la reserva, el cambio de estado, la `Cancellation`, el aviso a
 * la lista del día y la marca para Channex, en su transacción.
 *
 * Se mide el caso más pesado del spec, el del escenario 5: las habitaciones 101 y 102, llegada hoy y la
 * lista ya enviada, así que se deja el `REMOVED`. Antes se cancela una reserva por cada canal: la primera
 * conexión no es la de una aplicación en uso.
 */
describe('cancel-reservation: el procesamiento local en menos de 200 ms (NFR-001, T014)', () => {
  let world: CancellationApp;

  beforeAll(async () => {
    world = await CancellationApp.start();
    await world.reset();
    const reception = await world.storeDirect();
    const booking = await world.storeBooking();
    await world.sendDailyList();
    await world.cancelReservation.execute(fromReception(reception));
    await world.byBooking(booking.reservationRef);
  });

  beforeEach(async () => {
    await world.reset();
  });

  afterAll(async () => {
    await world?.close();
  });

  it('la Recepcionista', async () => {
    const stored = await world.storeDirect({
      rooms: [
        aDirectRoom({ roomNumber: '101' }),
        aDirectRoom({ roomNumber: '102' }),
      ],
    });
    await world.sendDailyList();

    const { result, elapsed } = await timed(() =>
      world.cancelReservation.execute(fromReception(stored)),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    // Fue la cancelación completa: con su Cancellation, el REMOVED y la marca para Channex.
    expect(result.status).toBe('CANCELLED');
    expect(await world.cancellations()).toHaveLength(1);
    expect(await world.listUpdates()).toMatchObject([
      { update_type: 'REMOVED', reservation_ref: stored.reservationRef },
    ]);
    expect(await world.availabilityMarks()).toHaveLength(1);
  });

  it('Booking, dentro de la transacción de quien llama', async () => {
    const stored = await world.storeBooking({
      rooms: [
        anOtaRoom({ roomNumber: '101' }),
        anOtaRoom({ roomNumber: '102' }),
      ],
    });
    await world.sendDailyList();

    const { result, elapsed } = await timed(() =>
      world.byBooking(stored.reservationRef),
    );

    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(result.status).toBe('CANCELLED');
    expect(await world.cancellations()).toHaveLength(1);
    expect(await world.listUpdates()).toMatchObject([
      { update_type: 'REMOVED', reservation_ref: stored.reservationRef },
    ]);
    expect(await world.availabilityMarks()).toHaveLength(1);
  });
});
