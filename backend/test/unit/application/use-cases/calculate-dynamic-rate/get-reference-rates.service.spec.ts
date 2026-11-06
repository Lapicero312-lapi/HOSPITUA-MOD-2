import { describe, expect, it } from 'vitest';
import { GetReferenceRatesService } from '../../../../../src/application/use-cases/calculate-dynamic-rate/get-reference-rates.service.js';

describe('GetReferenceRates (plan de calculate-dynamic-rate, C1 y D4)', () => {
  it('una tarifa por categoría de la configuración, ordenadas por categoryRoom, con el ajuste único', () => {
    const service = new GetReferenceRatesService({
      seasonAdjustmentPercentage: '15.00',
      currency: 'COP',
      baseRates: { SUITE: '480000.00', DOBLE: '220000.00', FAMILIAR: '350000' },
    });

    expect(
      service.execute().map((rate) => ({
        categoryRoom: rate.categoryRoom,
        baseRate: rate.baseRate.amountWithCents,
        currency: rate.effectiveRate.currency,
        seasonAdjustmentPercentage: rate.seasonAdjustmentPercentage,
        effectiveRate: rate.effectiveRate.amountWithCents,
      })),
    ).toEqual([
      {
        categoryRoom: 'DOBLE',
        baseRate: '220000.00',
        currency: 'COP',
        seasonAdjustmentPercentage: '15.00',
        effectiveRate: '253000.00',
      },
      {
        categoryRoom: 'FAMILIAR',
        baseRate: '350000.00',
        currency: 'COP',
        seasonAdjustmentPercentage: '15.00',
        effectiveRate: '402500.00',
      },
      {
        categoryRoom: 'SUITE',
        baseRate: '480000.00',
        currency: 'COP',
        seasonAdjustmentPercentage: '15.00',
        effectiveRate: '552000.00',
      },
    ]);
  });

  it('arma las tarifas en la moneda de RATE_REFERENCE, no en una fija', () => {
    const service = new GetReferenceRatesService({
      seasonAdjustmentPercentage: '10.00',
      currency: 'USD',
      baseRates: { DOBLE: '80.00' },
    });

    const [rate] = service.execute();

    expect(rate.baseRate.currency).toBe('USD');
    expect(rate.effectiveRate.currency).toBe('USD');
    expect(rate.effectiveRate.amountWithCents).toBe('88.00');
  });

  it('sin configuración, ninguna tarifa', () => {
    expect(new GetReferenceRatesService(null).execute()).toEqual([]);
  });
});
