import { describe, expect, it, vi } from 'vitest';
import type {
  ReconcileCommissions,
  ReconciliationOutcome,
} from '../../../../../src/application/use-cases/register-ota-information-commission/ports/in/reconcile-commissions.port.js';
import { ReconciliationsController } from '../../../../../src/infrastructure/in/rest/reconciliations.controller.js';

const MAX_ITEMS = 2;

/** El ejemplo de A2 del plan, con un ítem aplicado y otro rechazado. */
const OUTCOME: ReconciliationOutcome = {
  action: 'RECONCILED',
  results: [
    {
      reservationRef: 'RSV-8D02E5A4',
      result: 'APPLIED',
      commissionStatus: 'RECONCILED',
      reason: null,
    },
    {
      reservationRef: 'RSV-1A2B3C4D',
      result: 'REJECTED',
      commissionStatus: 'CALCULATED',
      reason: 'AMOUNT_MISMATCH',
    },
  ],
  summary: { applied: 1, alreadyApplied: 0, rejected: 1 },
};

const ITEM = {
  reservationRef: 'RSV-8D02E5A4',
  grossAmount: '400.00',
  commissionAmount: '60.00',
};

function controller() {
  const execute = vi.fn(() => Promise.resolve(OUTCOME));
  return {
    execute,
    controller: new ReconciliationsController(
      { execute } as unknown as ReconcileCommissions,
      MAX_ITEMS,
    ),
  };
}

describe('ReconciliationsController.execute (A2)', () => {
  it('responde el resultado del servicio tal cual, con los resultados por ítem y el resumen', async () => {
    const { controller: c } = controller();

    await expect(
      c.execute({ action: 'RECONCILED', items: [ITEM] }),
    ).resolves.toBe(OUTCOME);
  });

  it('le pasa al servicio la acción y los ítems revisados', async () => {
    const { controller: c, execute } = controller();

    await c.execute({ action: 'PAID', items: [ITEM] });

    expect(execute).toHaveBeenCalledWith('PAID', [ITEM]);
  });

  it('solo pasa al servicio los campos de cada ítem: lo que sobra en el cuerpo se descarta', async () => {
    const { controller: c, execute } = controller();

    await c.execute({
      action: 'PAID',
      items: [{ ...ITEM, currency: 'USD', otro: 'x' }],
    });

    expect(execute).toHaveBeenCalledWith('PAID', [ITEM]);
  });

  it.each([
    ['sin cuerpo', undefined, 'INVALID_RECONCILIATION_REQUEST'],
    [
      'con más ítems que el máximo',
      { action: 'PAID', items: [ITEM, ITEM, ITEM] },
      'INVALID_RECONCILIATION_REQUEST',
    ],
    [
      'con una acción inválida',
      { action: 'otra', items: [ITEM] },
      'INVALID_RECONCILIATION_ACTION',
    ],
    [
      'con una referencia inválida',
      { action: 'PAID', items: [{ ...ITEM, reservationRef: 'mal' }] },
      'INVALID_RESERVATION_CODE',
    ],
    [
      'con un importe inválido',
      { action: 'PAID', items: [{ ...ITEM, grossAmount: '-1' }] },
      'INVALID_AMOUNT',
    ],
  ])(
    'una solicitud %s responde %s y no procesa ningún ítem',
    async (_, body, errorCode) => {
      const { controller: c, execute } = controller();

      await expect(c.execute(body)).rejects.toMatchObject({ errorCode });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('con un ítem inválido entre varios buenos, no procesa ninguno', async () => {
    const { controller: c, execute } = controller();

    await expect(
      c.execute({
        action: 'PAID',
        items: [ITEM, { ...ITEM, commissionAmount: 'x' }],
      }),
    ).rejects.toMatchObject({ errorCode: 'INVALID_AMOUNT' });
    expect(execute).not.toHaveBeenCalled();
  });
});
