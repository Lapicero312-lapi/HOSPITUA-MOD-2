import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OtaBookingRevisionRepository } from '../../../../../src/application/ports/out/ota-booking-revision.repository.js';
import type { OtaNoShowReportRepository } from '../../../../../src/application/ports/out/ota-no-show-report.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import { OtaNoShowReporterService } from '../../../../../src/application/use-cases/generate-ota-reservation/ota-no-show-reporter.service.js';
import {
  aDirectReservation,
  anOtaReservation,
} from '../../../../support/builders.js';

const tx = { id: 'tx' } as unknown as Transaction;
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';

function aReporter(bookingId: string | null = BOOKING_ID) {
  const findBookingIdOf = vi
    .fn<OtaBookingRevisionRepository['findBookingIdOf']>()
    .mockResolvedValue(bookingId);
  const insertPending = vi
    .fn<OtaNoShowReportRepository['insertPending']>()
    .mockResolvedValue(undefined);
  const reporter = new OtaNoShowReporterService(
    { findBookingIdOf } as unknown as OtaBookingRevisionRepository,
    { insertPending } as unknown as OtaNoShowReportRepository,
  );
  return { reporter, findBookingIdOf, insertPending };
}

describe('OtaNoShowReporterService (plan de generate-ota-reservation, regla 9 y punto 8; T011b)', () => {
  it('deja PENDING el reporte de la reserva de Booking con el booking_id de sus revisiones, en la transacción del cierre', async () => {
    const reservation = anOtaReservation(randomUUID(), { status: 'NO_SHOW' });
    const { reporter, findBookingIdOf, insertPending } = aReporter();

    await reporter.record(tx, reservation);

    expect(findBookingIdOf).toHaveBeenCalledExactlyOnceWith(reservation.id, tx);
    expect(insertPending).toHaveBeenCalledExactlyOnceWith(
      tx,
      reservation.id,
      BOOKING_ID,
    );
  });

  it('una reserva de Booking sin ninguna revisión es un error del programa: no deja nada', async () => {
    const reservation = anOtaReservation(randomUUID());
    const { reporter, insertPending } = aReporter(null);

    await expect(reporter.record(tx, reservation)).rejects.toThrow(
      `La reserva ${reservation.reservationRef} de Booking no tiene ninguna revisión: no se puede dejar pendiente el reporte de su no-show.`,
    );
    expect(insertPending).not.toHaveBeenCalled();
  });

  it('una reserva directa es un error del programa: no busca revisiones ni deja nada', async () => {
    const reservation = aDirectReservation();
    const { reporter, findBookingIdOf, insertPending } = aReporter();

    await expect(reporter.record(tx, reservation)).rejects.toThrow(
      `La reserva ${reservation.reservationRef} no es de Booking: no tiene no-show que reportar.`,
    );
    expect(findBookingIdOf).not.toHaveBeenCalled();
    expect(insertPending).not.toHaveBeenCalled();
  });
});
