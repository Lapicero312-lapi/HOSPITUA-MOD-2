import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { COMMISSION_AUDIT_REPOSITORY } from '../../../../../src/application/ports/out/commission-audit.repository.js';
import { OTA_REPOSITORY } from '../../../../../src/application/ports/out/ota.repository.js';
import { RESERVATION_REPOSITORY } from '../../../../../src/application/ports/out/reservation.repository.js';
import { TRANSACTION_RUNNER } from '../../../../../src/application/ports/out/transaction.js';
import { RECONCILE_COMMISSIONS } from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/reconcile-commissions.port.js';
import { ReconcileCommissionsService } from '../../../../../src/application/use-cases/register-ota-information-commission/reconcile-commissions.service.js';
import { RegisterOtaInformationCommissionModule } from '../../../../../src/application/use-cases/register-ota-information-commission/register-ota-information-commission.module.js';

const GLOBAL_TOKENS = [
  OTA_REPOSITORY,
  RESERVATION_REPOSITORY,
  COMMISSION_AUDIT_REPOSITORY,
  TRANSACTION_RUNNER,
];

/** Lo que pone `PersistenceModule`, que es global: la base no se usa en esta prueba. */
@Global()
@Module({
  providers: GLOBAL_TOKENS.map((token) => ({ provide: token, useValue: {} })),
  exports: GLOBAL_TOKENS,
})
class FakeGlobalModule {}

const INJECTED = Symbol('INJECTED_RECONCILE');

describe('RegisterOtaInformationCommissionModule (plan base, regla 4; T012)', () => {
  it('arma ReconcileCommissions con los puertos de salida globales y lo exporta', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalModule, RegisterOtaInformationCommissionModule],
      // Un proveedor de fuera del módulo que lo inyecta: eso exige que el módulo lo exporte.
      providers: [
        {
          provide: INJECTED,
          inject: [RECONCILE_COMMISSIONS],
          useFactory: (reconcile: unknown) => reconcile,
        },
      ],
    }).compile();

    expect(moduleRef.get(INJECTED)).toBeInstanceOf(ReconcileCommissionsService);
    await moduleRef.close();
  });
});
