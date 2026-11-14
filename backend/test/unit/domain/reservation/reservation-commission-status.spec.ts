import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Money } from '../../../../src/domain/shared/money.js';
import {
  aDirectReservation,
  anOtaReservation,
  otaTerms,
} from '../../../support/builders.js';

const OTA_ID = randomUUID();

describe('Reservation.withCommissionStatus (T012 de register-ota-information-commission)', () => {
  it.each([
    ['CALCULATED', 'RECONCILED'],
    ['CALCULATED', 'PAID'],
    ['RECONCILED', 'PAID'],
  ] as const)(
    'cambia la comisión de %s a %s y deja todo lo demás igual',
    (from, to) => {
      const reservation = anOtaReservation(OTA_ID, {
        status: 'COMPLETED',
        ota: otaTerms(OTA_ID, { commissionStatus: from }),
      });

      const changed = reservation.withCommissionStatus(to);

      expect(changed.ota?.commissionStatus).toBe(to);
      expect(changed.ota?.commissionAmount.equals(Money.of('60', 'USD'))).toBe(
        true,
      );
      expect(changed.ota?.grossAmount.equals(Money.of('400', 'USD'))).toBe(
        true,
      );
      expect(changed.ota?.commissionPercentage).toBe('15');
      expect(changed.status).toBe('COMPLETED');
      expect(changed.reservationRef).toBe(reservation.reservationRef);
    },
  );

  it('no modifica la reserva original', () => {
    const reservation = anOtaReservation(OTA_ID, { status: 'COMPLETED' });

    reservation.withCommissionStatus('RECONCILED');

    expect(reservation.ota?.commissionStatus).toBe('CALCULATED');
  });

  it.each([
    ['PAID', 'RECONCILED'],
    ['PAID', 'CALCULATED'],
    ['RECONCILED', 'CALCULATED'],
    ['RECONCILED', 'RECONCILED'],
  ] as const)(
    'una transición que no está en la tabla (%s a %s) es un error del programa',
    (from, to) => {
      const reservation = anOtaReservation(OTA_ID, {
        status: 'COMPLETED',
        ota: otaTerms(OTA_ID, { commissionStatus: from }),
      });

      expect(() => reservation.withCommissionStatus(to)).toThrow(
        /no puede pasar su comisión/,
      );
    },
  );

  it('una reserva directa no tiene comisión que conciliar', () => {
    expect(() =>
      aDirectReservation().withCommissionStatus('RECONCILED'),
    ).toThrow(/es directa/);
  });
});
