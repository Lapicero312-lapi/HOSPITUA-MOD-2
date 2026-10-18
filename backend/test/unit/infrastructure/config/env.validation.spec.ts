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
    });

    expect(config.NODE_ENV).toBe('production');
  });

  it('una clave vacía definida a propósito se rechaza, no se reemplaza por el valor por defecto', () => {
    expect(() => validateEnv({ DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
  });

  it('no exige las variables de Channex: el Módulo 2 arranca sin ellas', () => {
    expect(() => validateEnv({})).not.toThrow();
  });
});
