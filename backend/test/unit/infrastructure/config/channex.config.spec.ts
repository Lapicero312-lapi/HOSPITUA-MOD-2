import { describe, expect, it } from 'vitest';
import { readChannexConfig } from '../../../../src/infrastructure/config/channex.config.js';

const PROPERTY_ID = '716305C4-561A-4561-A187-7F5B8AEB5920';
const API_KEY = 'clave-de-prueba-que-no-debe-salir';

const VALID = {
  CHANNEX_BASE_URL: 'https://staging.channex.io/',
  CHANNEX_API_KEY: API_KEY,
  CHANNEX_PROPERTY_ID: PROPERTY_ID,
  CHANNEX_SYNC_INTERVAL_SECONDS: '45',
  CHANNEX_ARI_DAYS: '120',
};

const configWith = (values: Record<string, string | undefined>) =>
  readChannexConfig((name) => values[name]);

describe('readChannexConfig', () => {
  it('con las cinco variables válidas entrega la configuración, sin la clave', () => {
    expect(configWith(VALID)).toEqual({
      valid: true,
      settings: {
        baseUrl: 'https://staging.channex.io',
        propertyId: PROPERTY_ID.toLowerCase(),
        syncIntervalSeconds: 45,
        ariDays: 120,
      },
    });
    expect(JSON.stringify(configWith(VALID))).not.toContain(API_KEY);
  });

  it('sin dirección, intervalo ni días usa staging, 30 s y 90 días', () => {
    const result = configWith({
      ...VALID,
      CHANNEX_BASE_URL: undefined,
      CHANNEX_SYNC_INTERVAL_SECONDS: '',
      CHANNEX_ARI_DAYS: '  ',
    });

    expect(result).toMatchObject({
      valid: true,
      settings: {
        baseUrl: 'https://staging.channex.io',
        syncIntervalSeconds: 30,
        ariDays: 90,
      },
    });
  });

  it('el id del hotel y el porcentaje de comisión ya no se configuran: se ignoran si siguen en el .env', () => {
    const result = configWith({
      ...VALID,
      BOOKING_HOTEL_ID: 'no es un número',
      BOOKING_COMMISSION_PERCENTAGE: '150',
    });

    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain('150');
  });

  it.each([
    ['CHANNEX_API_KEY', ''],
    ['CHANNEX_API_KEY', undefined],
    ['CHANNEX_PROPERTY_ID', undefined],
    ['CHANNEX_PROPERTY_ID', 'propiedad-1'],
    ['CHANNEX_BASE_URL', 'ftp://staging.channex.io'],
    ['CHANNEX_BASE_URL', 'staging.channex.io'],
    ['CHANNEX_SYNC_INTERVAL_SECONDS', '29'],
    ['CHANNEX_SYNC_INTERVAL_SECONDS', '30.5'],
    ['CHANNEX_ARI_DAYS', '0'],
    ['CHANNEX_ARI_DAYS', 'noventa'],
  ])('%s con %j es inválida y se nombra, sin su valor', (name, value) => {
    const result = configWith({ ...VALID, [name]: value });

    expect(result).toEqual({ valid: false, invalid: [name] });
  });

  it('nombra todas las variables que fallan a la vez', () => {
    expect(configWith({})).toEqual({
      valid: false,
      invalid: ['CHANNEX_API_KEY', 'CHANNEX_PROPERTY_ID'],
    });
  });
});
