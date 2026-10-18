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

export const ENTORNOS = ['development', 'test', 'production'] as const;
export type Entorno = (typeof ENTORNOS)[number];

const NIVELES_DE_LOG = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

const OPCIONES_URL_HTTP = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_tld: false,
};

/**
 * Variables de entorno que necesita el Módulo 2 para arrancar.
 *
 * Las de Channex (CHANNEX_*, BOOKING_*) NO están aquí a propósito: si faltan o son inválidas, solo se
 * apagan las tareas de Channex y el resto del Módulo 2 debe funcionar igual (spec "Configurar OTA").
 * Esas las valida ese caso de uso.
 */
export class EnvironmentVariables {
  @IsIn(ENTORNOS)
  NODE_ENV!: Entorno;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsIn(NIVELES_DE_LOG)
  LOG_LEVEL!: (typeof NIVELES_DE_LOG)[number];

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
  @IsUrl(OPCIONES_URL_HTTP)
  MODULE1_BASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60000)
  MODULE1_TIMEOUT_MS!: number;

  // Módulo 3: tiempo máximo de espera de 3 s (si no responde, nunca se asume una tarifa)
  @IsUrl(OPCIONES_URL_HTTP)
  MODULE3_BASE_URL!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(60000)
  MODULE3_TIMEOUT_MS!: number;
}

/** Valores que se usan si la variable no está definida, en cualquier entorno. */
const VALORES_POR_DEFECTO = {
  NODE_ENV: 'development',
  PORT: 3000,
  LOG_LEVEL: 'info',
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_NAME: 'hospitua',
  DB_USER: 'hospitua',
  MODULE1_TIMEOUT_MS: 1000,
  MODULE3_TIMEOUT_MS: 3000,
};

/**
 * Valores solo para desarrollo y pruebas (coinciden con docker-compose.yml).
 * En producción no existen: las claves y las direcciones deben venir siempre del entorno.
 */
const VALORES_SOLO_FUERA_DE_PRODUCCION = {
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
  const entorno = config.NODE_ENV ?? VALORES_POR_DEFECTO.NODE_ENV;
  const porDefecto =
    entorno === 'production'
      ? VALORES_POR_DEFECTO
      : { ...VALORES_POR_DEFECTO, ...VALORES_SOLO_FUERA_DE_PRODUCCION };

  const validadas = plainToInstance(EnvironmentVariables, {
    ...porDefecto,
    ...config,
  });

  const errores = validateSync(validadas, {
    validationError: { target: false, value: false },
  });

  if (errores.length > 0) {
    const detalle = errores
      .map(
        (error) =>
          ` - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`,
      )
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${detalle}`);
  }

  return validadas;
}
