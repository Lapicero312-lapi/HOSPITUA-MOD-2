import { Inject, Injectable } from '@nestjs/common';
import {
  referenceRateOf,
  type ReferenceRate,
} from '../../../domain/rate/reference-rate.js';
import { Money } from '../../../domain/shared/money.js';
import {
  RATE_REFERENCE,
  type GetReferenceRates,
  type RateReferenceSettings,
} from './ports/in/get-reference-rates.port.js';

/**
 * La pantalla "Tarifas" (plan de `calculate-dynamic-rate`, C1 y D4): las tarifas salen de la configuración
 * local `RATE_REFERENCE`, sin llamar al Módulo 3 ni al Módulo 1, y no se guarda nada.
 */
@Injectable()
export class GetReferenceRatesService implements GetReferenceRates {
  constructor(
    @Inject(RATE_REFERENCE)
    private readonly settings: RateReferenceSettings | null,
  ) {}

  execute(): ReferenceRate[] {
    if (this.settings === null) {
      return [];
    }
    const { baseRates, currency, seasonAdjustmentPercentage } = this.settings;
    return Object.keys(baseRates)
      .sort()
      .map((categoryRoom) =>
        referenceRateOf(
          categoryRoom,
          Money.of(baseRates[categoryRoom], currency),
          seasonAdjustmentPercentage,
        ),
      );
  }
}
