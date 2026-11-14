import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../../../src/infrastructure/config/env.validation.js';

describe('validateEnv', () => {
  it('usa los valores de desarrollo cuando no hay ninguna variable', () => {
    const config = validateEnv({});

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.DB_HOST).toBe('localhost');
    expect(config.DB_PORT).toBe(5432);
    expect(config.MODULE1_TIMEOUT_MS).toBe(1000);
    expect(config.MODULE3_TIMEOUT_MS).toBe(3000);
  });

  it('convierte a número las variables que llegan como texto', () => {
    const config = validateEnv({ PORT: '4000', DB_PORT: '6543' });

    expect(config.PORT).toBe(4000);
    expect(config.DB_PORT).toBe(6543);
  });

  it('acepta el entorno de pruebas', () => {
    expect(validateEnv({ NODE_ENV: 'test' }).NODE_ENV).toBe('test');
  });

  it('rechaza un puerto que no es un número y no escribe el valor en el mensaje', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ PORT: 'abc' })).not.toThrow(/abc/);
  });

  it('rechaza un entorno desconocido', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rechaza una dirección de RabbitMQ que no es amqp', () => {
    expect(() => validateEnv({ RABBITMQ_URL: 'http://localhost' })).toThrow(
      /RABBITMQ_URL/,
    );
  });

  it('rechaza una dirección del Módulo 1 sin protocolo', () => {
    expect(() => validateEnv({ MODULE1_BASE_URL: 'localhost:4001' })).toThrow(
      /MODULE1_BASE_URL/,
    );
  });

  it('rechaza un tiempo de espera fuera de rango', () => {
    expect(() => validateEnv({ MODULE3_TIMEOUT_MS: '5' })).toThrow(
      /MODULE3_TIMEOUT_MS/,
    );
  });

  it('en producción exige la clave y las direcciones: no hay valores por defecto', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /DB_PASSWORD[\s\S]*RABBITMQ_URL|RABBITMQ_URL[\s\S]*DB_PASSWORD/,
    );
  });

  it('en producción arranca si están todas las obligatorias', () => {
    const config = validateEnv({
      NODE_ENV: 'production',
      DB_PASSWORD: 'una-clave-larga',
      RABBITMQ_URL: 'amqps://usuario:clave@rabbit.interno:5671',
      MODULE1_BASE_URL: 'https://modulo1.interno',
      MODULE3_BASE_URL: 'https://modulo3.interno',
      SIRE_HOTEL_CODE: 'HOTEL-PRUEBA',
      SIRE_CITY_CODE: 'CIUDAD-PRUEBA',
    });

    expect(config.NODE_ENV).toBe('production');
  });

  it('una clave vacía definida a propósito se rechaza, no se reemplaza por el valor por defecto', () => {
    expect(() => validateEnv({ DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
  });

  it('no exige las variables de Channex: el Módulo 2 arranca sin ellas', () => {
    expect(() => validateEnv({})).not.toThrow();
  });

  describe('variables de SIRE (plan de export-sire-file, "Configuración del formato")', () => {
    /** Producción con todo lo obligatorio salvo SIRE. */
    const PRODUCTION = {
      NODE_ENV: 'production',
      DB_PASSWORD: 'una-clave-larga',
      RABBITMQ_URL: 'amqps://usuario:clave@rabbit.interno:5671',
      MODULE1_BASE_URL: 'https://modulo1.interno',
      MODULE3_BASE_URL: 'https://modulo3.interno',
    };

    it('en producción no arranca sin el hotel ni la ciudad, y las nombra sin sus valores', () => {
      expect(() => validateEnv(PRODUCTION)).toThrow(
        /SIRE_HOTEL_CODE[\s\S]*SIRE_CITY_CODE/,
      );
      expect(() =>
        validateEnv({ ...PRODUCTION, SIRE_HOTEL_CODE: 'HOTEL-PRUEBA' }),
      ).toThrow(/SIRE_CITY_CODE/);
    });

    it('fuera de producción usa valores que se notan falsos y los valores por defecto del plan', () => {
      const config = validateEnv({});

      expect(config.SIRE_HOTEL_CODE).toBe('DEV-HOTEL');
      expect(config.SIRE_CITY_CODE).toBe('DEV-CIUDAD');
      expect(config.SIRE_FIELD_SEPARATOR).toBe('TAB');
      expect(config.SIRE_DATE_FORMAT).toBe('dd/MM/yyyy');
      expect(config.SIRE_LINE_BREAK).toBe('CRLF');
      expect(config.SIRE_FILE_ENCODING).toBe('utf-8');
      expect(config.SIRE_MAX_PERIOD_DAYS).toBe(366);
      expect(config.SIRE_MAX_RECORDS).toBe(50000);
      expect(config.SIRE_RATE_LIMIT_PER_MINUTE).toBe(10);
      expect(config.SIRE_MAX_CONCURRENT).toBe(3);
    });

    it('un hotel vacío definido a propósito se rechaza', () => {
      expect(() => validateEnv({ SIRE_HOTEL_CODE: '' })).toThrow(
        /SIRE_HOTEL_CODE/,
      );
    });

    it.each([
      ['SIRE_FIELD_SEPARATOR', '|'],
      ['SIRE_DATE_FORMAT', 'yyyy-MM-dd'],
      ['SIRE_LINE_BREAK', 'LF'],
      ['SIRE_FILE_ENCODING', 'latin1'],
    ])('acepta %s = %s', (name, value) => {
      expect(validateEnv({ [name]: value })[name as 'SIRE_LINE_BREAK']).toBe(
        value,
      );
    });

    it.each([
      ['SIRE_FIELD_SEPARATOR', 'A'],
      ['SIRE_FIELD_SEPARATOR', 'ab'],
      ['SIRE_FIELD_SEPARATOR', '||'],
      ['SIRE_DATE_FORMAT', 'dd/MM'],
      ['SIRE_LINE_BREAK', 'CR'],
      ['SIRE_FILE_ENCODING', 'ascii'],
      ['SIRE_MAX_PERIOD_DAYS', '0'],
      ['SIRE_MAX_RECORDS', '0'],
      ['SIRE_RATE_LIMIT_PER_MINUTE', '0'],
      ['SIRE_MAX_CONCURRENT', '0'],
      ['SIRE_MAX_CONCURRENT', '1.5'],
    ])('rechaza %s = %s', (name, value) => {
      expect(() => validateEnv({ [name]: value })).toThrow(new RegExp(name));
    });

    it('convierte a número los límites que llegan como texto', () => {
      expect(
        validateEnv({ SIRE_MAX_PERIOD_DAYS: '30' }).SIRE_MAX_PERIOD_DAYS,
      ).toBe(30);
    });
  });
});
