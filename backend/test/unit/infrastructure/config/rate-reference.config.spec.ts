import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { RATE_REFERENCE } from '../../../../src/application/use-cases/calculate-dynamic-rate/ports/in/get-reference-rates.port.js';
import { validateEnv } from '../../../../src/infrastructure/config/env.validation.js';
import {
  isValidRateReference,
  parseRateReference,
  RateReferenceConfigModule,
} from '../../../../src/infrastructure/config/rate-reference.config.js';

/** `RATE_REFERENCE` como la entrega `RateReferenceConfigModule` con esa variable en la configuración. */
async function providedWith(value: string | undefined): Promise<unknown> {
  @Global()
  @Module({
    providers: [
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'RATE_REFERENCE' ? value : undefined),
        },
      },
    ],
    exports: [ConfigService],
  })
  class FakeConfigModule {}

  const injected = Symbol('INJECTED_RATE_REFERENCE');
  const moduleRef = await Test.createTestingModule({
    imports: [FakeConfigModule, RateReferenceConfigModule],
    providers: [
      {
        provide: injected,
        inject: [RATE_REFERENCE],
        useFactory: (settings: unknown) => settings,
      },
    ],
  }).compile();
  const settings = moduleRef.get(injected);
  await moduleRef.close();
  return settings;
}

/** El JSON del ejemplo de C1 del plan. */
const EXAMPLE = {
  seasonAdjustmentPercentage: '15.00',
  currency: 'COP',
  baseRates: { DOBLE: '220000.00', SUITE: '480000.00' },
};

const json = (changes: Record<string, unknown> = {}) =>
  JSON.stringify({ ...EXAMPLE, ...changes });

describe('RATE_REFERENCE (plan de calculate-dynamic-rate, C1 y punto 12)', () => {
  describe('RateReferenceConfigModule', () => {
    it('entrega la configuración leída de RATE_REFERENCE, y es global: se inyecta desde fuera', async () => {
      await expect(providedWith(json())).resolves.toEqual(EXAMPLE);
    });

    it('sin RATE_REFERENCE entrega null', async () => {
      await expect(providedWith(undefined)).resolves.toBeNull();
    });
  });

  describe('parseRateReference', () => {
    it('lee el ejemplo de C1', () => {
      expect(parseRateReference(json())).toEqual(EXAMPLE);
    });

    it.each([
      ['ausente', undefined],
      ['vacía', ''],
    ])('%s: no está configurada (null)', (_, value) => {
      expect(parseRateReference(value)).toBeNull();
    });

    it('una inválida es un error del programa: validateEnv ya la rechazó', () => {
      expect(() => parseRateReference('no es JSON')).toThrow(
        'RATE_REFERENCE no es válida.',
      );
    });
  });

  describe('isValidRateReference', () => {
    it.each([
      ['el ejemplo de C1', json()],
      ['un ajuste negativo', json({ seasonAdjustmentPercentage: '-10.00' })],
      ['un ajuste de -99.99', json({ seasonAdjustmentPercentage: '-99.99' })],
      ['el máximo de 100', json({ seasonAdjustmentPercentage: '100' })],
      ['un ajuste en cero', json({ seasonAdjustmentPercentage: '0' })],
      ['una tarifa de un decimal', json({ baseRates: { DOBLE: '220000.5' } })],
      ['una sola categoría', json({ baseRates: { SUITE_JUNIOR: '480000' } })],
      ['otra moneda', json({ currency: 'USD' })],
      ['ausente', undefined],
      ['vacía', ''],
    ])('acepta %s', (_, value) => {
      expect(isValidRateReference(value)).toBe(true);
    });

    it.each([
      ['un texto que no es JSON', 'DOBLE=220000'],
      ['un JSON que no es un objeto', '[1, 2]'],
      ['un número', 42],
      [
        'sin seasonAdjustmentPercentage',
        json({ seasonAdjustmentPercentage: undefined }),
      ],
      ['un ajuste de -100', json({ seasonAdjustmentPercentage: '-100' })],
      ['un ajuste de 100.01', json({ seasonAdjustmentPercentage: '100.01' })],
      [
        'un ajuste de tres decimales',
        json({ seasonAdjustmentPercentage: '15.005' }),
      ],
      ['un ajuste como número', json({ seasonAdjustmentPercentage: 15 })],
      ['un ajuste con signo +', json({ seasonAdjustmentPercentage: '+15' })],
      ['sin currency', json({ currency: undefined })],
      ['una moneda en minúscula', json({ currency: 'cop' })],
      ['una moneda de 4 letras', json({ currency: 'COPS' })],
      ['sin baseRates', json({ baseRates: undefined })],
      ['baseRates vacío', json({ baseRates: {} })],
      ['baseRates como lista', json({ baseRates: ['220000.00'] })],
      [
        'una categoría en minúscula',
        json({ baseRates: { doble: '220000.00' } }),
      ],
      [
        'una categoría con espacio',
        json({ baseRates: { 'DOBLE SUPERIOR': '1.00' } }),
      ],
      [
        'una categoría de 51 caracteres',
        json({ baseRates: { ['A'.repeat(51)]: '1.00' } }),
      ],
      ['una tarifa en cero', json({ baseRates: { DOBLE: '0.00' } })],
      ['una tarifa negativa', json({ baseRates: { DOBLE: '-1.00' } })],
      ['una tarifa de tres decimales', json({ baseRates: { DOBLE: '1.005' } })],
      ['una tarifa como número', json({ baseRates: { DOBLE: 220000 } })],
    ])('rechaza %s', (_, value) => {
      expect(isValidRateReference(value)).toBe(false);
    });
  });

  describe('al arrancar (validateEnv)', () => {
    it('sin RATE_REFERENCE arranca: es opcional', () => {
      expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
    });

    it('con el ejemplo de C1 arranca', () => {
      expect(
        validateEnv({ NODE_ENV: 'test', RATE_REFERENCE: json() })
          .RATE_REFERENCE,
      ).toBe(json());
    });

    it('con una inválida no arranca, nombra la variable y no escribe su valor', () => {
      const secretLooking = json({ currency: 'valor-que-no-debe-salir' });

      let message = '';
      try {
        validateEnv({ NODE_ENV: 'test', RATE_REFERENCE: secretLooking });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('RATE_REFERENCE');
      expect(message).not.toContain('valor-que-no-debe-salir');
    });
  });
});
