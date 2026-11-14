import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import {
  SIRE_CONFIG,
  type SireConfig,
} from '../../application/ports/out/sire-config.js';

/**
 * Variables de "Exportar archivo SIRE" (plan de `export-sire-file`, "Configuración del formato"). El spec
 * pide tomar el formato de configuración, no fijarlo en el código (FR-005). `EnvironmentVariables` las
 * hereda, así que se validan al arrancar: si falta el hotel o la ciudad en producción, no arranca.
 */
export class SireEnvironmentVariables {
  // Campo 1 del archivo: código del hotel en SIRE (obligatorio)
  @IsString()
  @IsNotEmpty()
  SIRE_HOTEL_CODE!: string;

  // Campo 2 del archivo: código de la ciudad del hotel (obligatorio)
  @IsString()
  @IsNotEmpty()
  SIRE_CITY_CODE!: string;

  // Separador de campos: `TAB` (el tabulador) o un solo carácter que no sea letra, dígito ni espacio
  @Matches(/^(TAB|[^\sA-Za-z0-9])$/, {
    message: 'SIRE_FIELD_SEPARATOR debe ser TAB o un solo carácter',
  })
  SIRE_FIELD_SEPARATOR!: string;

  // Formato de las fechas (campos 9 y 12): debe tener el día (dd), el mes (MM) y el año (yyyy)
  @Matches(/^(?=.*dd)(?=.*MM)(?=.*yyyy).+$/, {
    message: 'SIRE_DATE_FORMAT debe tener dd, MM y yyyy',
  })
  SIRE_DATE_FORMAT!: string;

  // Fin de línea del archivo
  @IsIn(['CRLF', 'LF'])
  SIRE_LINE_BREAK!: string;

  // Codificación del archivo
  @IsIn(['utf-8', 'latin1'])
  SIRE_FILE_ENCODING!: string;

  // Máximo del periodo, en días
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SIRE_MAX_PERIOD_DAYS!: number;

  // Máximo de líneas por archivo (para no agotar la memoria)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SIRE_MAX_RECORDS!: number;

  // Límite de solicitudes de exportación por minuto, por usuario (`X-User`)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SIRE_RATE_LIMIT_PER_MINUTE!: number;

  // Exportaciones simultáneas
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SIRE_MAX_CONCURRENT!: number;
}

/**
 * Valores por defecto en cualquier entorno: los del plan, "mientras no se confirme el manual de cargue de
 * SIRE" (punto 4 de "Puntos que este plan propone").
 */
export const SIRE_DEFAULTS = {
  SIRE_FIELD_SEPARATOR: 'TAB',
  SIRE_DATE_FORMAT: 'dd/MM/yyyy',
  SIRE_LINE_BREAK: 'CRLF',
  SIRE_FILE_ENCODING: 'utf-8',
  SIRE_MAX_PERIOD_DAYS: 366,
  SIRE_MAX_RECORDS: 50000,
  SIRE_RATE_LIMIT_PER_MINUTE: 10,
  SIRE_MAX_CONCURRENT: 3,
};

/**
 * Solo para desarrollo y pruebas: valores que se notan falsos. En producción no existen: el hotel y la
 * ciudad reales deben venir siempre del entorno.
 */
export const SIRE_NON_PRODUCTION_DEFAULTS = {
  SIRE_HOTEL_CODE: 'DEV-HOTEL',
  SIRE_CITY_CODE: 'DEV-CIUDAD',
};

/** Las variables `SIRE_*` que arman el `SireConfig`, ya validadas al arrancar. */
type SireVariables = Pick<
  SireEnvironmentVariables,
  | 'SIRE_HOTEL_CODE'
  | 'SIRE_CITY_CODE'
  | 'SIRE_FIELD_SEPARATOR'
  | 'SIRE_DATE_FORMAT'
  | 'SIRE_LINE_BREAK'
  | 'SIRE_FILE_ENCODING'
  | 'SIRE_MAX_PERIOD_DAYS'
  | 'SIRE_MAX_RECORDS'
>;

/**
 * El `SireConfig` a partir de las variables: `TAB` es el tabulador, `CRLF` es `\r\n` y `LF` es `\n`. Los
 * demás valores pasan tal cual.
 */
export function sireConfigFrom(variables: SireVariables): SireConfig {
  return {
    format: {
      hotelCode: variables.SIRE_HOTEL_CODE,
      cityCode: variables.SIRE_CITY_CODE,
      fieldSeparator:
        variables.SIRE_FIELD_SEPARATOR === 'TAB'
          ? '\t'
          : variables.SIRE_FIELD_SEPARATOR,
      dateFormat: variables.SIRE_DATE_FORMAT,
      encoding: variables.SIRE_FILE_ENCODING === 'latin1' ? 'latin1' : 'utf-8',
    },
    lineBreak: variables.SIRE_LINE_BREAK === 'LF' ? '\n' : '\r\n',
    maxPeriodDays: variables.SIRE_MAX_PERIOD_DAYS,
    maxRecords: variables.SIRE_MAX_RECORDS,
  };
}

/**
 * Entrega `SIRE_CONFIG` desde la configuración validada. Es global: `ExportSireFile` y `SireController` lo
 * inyectan sin importarlo, como `RATE_REFERENCE` de `RateReferenceConfigModule`.
 */
@Global()
@Module({
  providers: [
    {
      provide: SIRE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<SireVariables, true>) =>
        sireConfigFrom({
          SIRE_HOTEL_CODE: config.get('SIRE_HOTEL_CODE', { infer: true }),
          SIRE_CITY_CODE: config.get('SIRE_CITY_CODE', { infer: true }),
          SIRE_FIELD_SEPARATOR: config.get('SIRE_FIELD_SEPARATOR', {
            infer: true,
          }),
          SIRE_DATE_FORMAT: config.get('SIRE_DATE_FORMAT', { infer: true }),
          SIRE_LINE_BREAK: config.get('SIRE_LINE_BREAK', { infer: true }),
          SIRE_FILE_ENCODING: config.get('SIRE_FILE_ENCODING', { infer: true }),
          SIRE_MAX_PERIOD_DAYS: config.get('SIRE_MAX_PERIOD_DAYS', {
            infer: true,
          }),
          SIRE_MAX_RECORDS: config.get('SIRE_MAX_RECORDS', { infer: true }),
        }),
    },
  ],
  exports: [SIRE_CONFIG],
})
export class SireConfigModule {}
