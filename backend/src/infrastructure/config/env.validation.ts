import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export const ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

const HTTP_URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

/**
 * Variables de entorno que necesita el Módulo 2 para arrancar.
 *
 * Las de Channex (CHANNEX_*) NO están aquí a propósito: si faltan o son inválidas, solo se
 * apagan las tareas de Channex y el resto del Módulo 2 debe funcionar igual (spec "Configurar OTA").
 * Esas las valida ese caso de uso.
 */
export class EnvironmentVariables {
  @IsIn(ENVIRONMENTS)
  NODE_ENV!: Environment;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL!: (typeof LOG_LEVELS)[number];

  // PostgreSQL
  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsString()
  @IsNotEmpty()
  DB_USER!: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  // RabbitMQ
  @Matches(/^amqps?:\/\/\S+$/, {
    message: 'RABBITMQ_URL debe empezar por amqp:// o amqps://',
  })
  RABBITMQ_URL!: string;

  // Módulo 1: tiempo máximo de espera de 1 s (si no responde, nunca se asume disponibilidad)
  @IsUrl(HTTP_URL_OPTIONS)
  MODULE1_BASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60000)
  MODULE1_TIMEOUT_MS!: number;

  // Módulo 3: tiempo máximo de espera de 3 s (si no responde, nunca se asume una tarifa)
  @IsUrl(HTTP_URL_OPTIONS)
  MODULE3_BASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60000)
  MODULE3_TIMEOUT_MS!: number;

  // Verificar disponibilidad: cuántas consultas de mantenimiento al Módulo 1 van en paralelo
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAINTENANCE_CONCURRENCY!: number;

  // Reserva directa: reintentos de asignación cuando la base rechaza una habitación por solape
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ASSIGNMENT_MAX_RETRIES!: number;

  // Conciliación de comisiones OTA: máximo de ítems por solicitud del Módulo 3
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RECONCILIATION_MAX_ITEMS!: number;

  // Calcular tarifa dinámica: cuántas cotizaciones al Módulo 3 van en paralelo (una por habitación)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  QUOTE_CONCURRENCY!: number;
}

/** Valores que se usan si la variable no está definida, en cualquier entorno. */
const DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 3000,
  LOG_LEVEL: 'info',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_NAME: 'hospitua',
  DB_USER: 'hospitua',
  MODULE1_TIMEOUT_MS: 1000,
  MODULE3_TIMEOUT_MS: 3000,
  MAINTENANCE_CONCURRENCY: 5,
  ASSIGNMENT_MAX_RETRIES: 3,
  RECONCILIATION_MAX_ITEMS: 500,
  QUOTE_CONCURRENCY: 5,
};

/**
 * Valores solo para desarrollo y pruebas (coinciden con docker-compose.yml).
 * En producción no existen: las claves y las direcciones deben venir siempre del entorno.
 */
const NON_PRODUCTION_DEFAULTS = {
  DB_PASSWORD: 'hospitua',
  RABBITMQ_URL: 'amqp://hospitua:hospitua@localhost:5672',
  MODULE1_BASE_URL: 'http://localhost:4001',
  MODULE3_BASE_URL: 'http://localhost:4003',
};

/**
 * Valida las variables de entorno al arrancar. Si alguna es inválida, la aplicación no arranca y el
 * mensaje dice cuáles son, SIN escribir sus valores (pueden ser claves).
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const environment = config.NODE_ENV ?? DEFAULTS.NODE_ENV;
  const defaults =
    environment === 'production'
      ? DEFAULTS
      : { ...DEFAULTS, ...NON_PRODUCTION_DEFAULTS };

  const validated = plainToInstance(EnvironmentVariables, {
    ...defaults,
    ...config,
  });

  const errors = validateSync(validated, {
    validationError: { target: false, value: false },
  });

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          ` - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`,
      )
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${details}`);
  }

  return validated;
}
