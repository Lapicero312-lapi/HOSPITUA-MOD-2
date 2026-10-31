import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
} from 'class-validator';

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
