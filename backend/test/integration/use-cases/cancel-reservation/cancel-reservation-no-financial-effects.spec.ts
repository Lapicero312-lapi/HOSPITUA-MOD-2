import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  MODULE3_PORT,
  type Module3Port,
} from '../../../../src/application/ports/out/module3.port.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../../../src/application/ports/out/transaction.js';
import {
  CANCEL_RESERVATION,
  type CancelReservation,
} from '../../../../src/application/use-cases/cancel-reservation/ports/in/cancel-reservation.port.js';
import { colombiaTimeWithMicroseconds } from '../../../../src/application/use-cases/check-view-reservation/message-time.js';
import type { ReservationProps } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { TypeOrmReservationRepository } from '../../../../src/infrastructure/out/persistence/repositories/reservation.repository.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../../support/builders.js';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** El Módulo 3 simulado: si la cancelación lo llamara, esta función lo registraría. */
const createQuote = vi.fn<Module3Port['createQuote']>();

type CommissionRow = {
  gross_amount: string | null;
  currency: string | null;
  commission_percentage: string | null;
  commission_amount: string | null;
  commission_status: string | null;
};

/**
 * T010 de `cancel-reservation` (FR-006 y regla 7): cancelar no tiene efectos financieros. Es la aplicación
 * completa (`AppModule`) con PostgreSQL real y el Módulo 3 simulado, para que la prueba valga para todo lo
 * que `CancelReservation` tenga conectado, y no solo para lo que se le pase a mano.
 */
describe('Cancelar no tiene efectos financieros (T010, FR-006)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let reservations: TypeOrmReservationRepository;
  let cancellation: CancelReservation;
  let transactions: TransactionRunner;

  const commissionOf = async (
    reservationId: string,
  ): Promise<CommissionRow> => {
    const [row]: CommissionRow[] = await dataSource.query(
      `SELECT gross_amount::text, currency, commission_percentage::text, commission_amount::text, commission_status
       FROM reservation WHERE id = $1`,
      [reservationId],
    );
    return row;
  };

  const aStoredBookingReservation = async (
    changes: Partial<ReservationProps>,
  ) => {
    const ota = await new TypeOrmOtaRepository(dataSource).insert(anOta());
    return reservations.insert(
      anOtaReservation(ota.id, {
        startDate: '2031-06-10',
        endDate: '2031-06-12',
        ota: otaTerms(ota.id, {
          grossAmount: Money.of('400', 'USD'),
          commissionPercentage: '15',
          commissionAmount: Money.of('60', 'USD'),
          commissionStatus: 'CALCULATED',
        }),
        ...changes,
      }),
    );
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    await truncateAllTables(dataSource);
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
    const { AppModule } = await import('../../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODULE3_PORT)
      .useValue({ createQuote } satisfies Module3Port)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    reservations = new TypeOrmReservationRepository(dataSource);
    cancellation = app.get<CancelReservation>(CANCEL_RESERVATION);
    transactions = app.get<TransactionRunner>(TRANSACTION_RUNNER);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    createQuote.mockReset();
  });

  afterAll(async () => {
    await app?.close();
    await dataSource?.destroy();
  });

  it.each(['ACTIVE', 'PENDING'] as const)(
    'Booking cancela una reserva en %s: conserva su comisión y no llama al Módulo 3',
    async (status) => {
      const saved = await aStoredBookingReservation({ status });

      const cancelled = await transactions.run((tx) =>
        cancellation.cancel(tx, {
          reservationRef: saved.reservationRef,
          channel: 'OTA_API',
          processedBy: 'Booking.com',
          reason: null,
        }),
      );

      expect(cancelled.status).toBe('CANCELLED');
      expect(await commissionOf(saved.id)).toEqual({
        gross_amount: '400.00',
        currency: 'USD',
        commission_percentage: '15.00',
        commission_amount: '60.00',
        commission_status: 'CALCULATED',
      });
      expect(createQuote).not.toHaveBeenCalled();
    },
  );

  it('la Recepcionista cancela una directa: su comisión no cambia y no llama al Módulo 3', async () => {
    const saved = await reservations.insert(
      aDirectReservation({ startDate: '2031-06-10', endDate: '2031-06-12' }),
    );
    const before = await commissionOf(saved.id);

    await cancellation.execute({
      reservationRef: saved.reservationRef,
      channel: 'RECEPTION',
      processedBy: 'laura.mendez',
      reason: null,
      acknowledged: true,
      expectedUpdatedAt: colombiaTimeWithMicroseconds(
        saved.updatedAt as string,
      ),
    });

    await expect(
      reservations.findByRef(saved.reservationRef),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(await commissionOf(saved.id)).toEqual(before);
    expect(createQuote).not.toHaveBeenCalled();
  });
});
