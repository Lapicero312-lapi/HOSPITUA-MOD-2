import type { SireLineFormat } from '../../../domain/migration/sire-line.js';

/** Símbolo con el que Nest inyecta la configuración (plan base, regla 4). */
export const SIRE_CONFIG = Symbol('SIRE_CONFIG');

/**
 * La configuración del archivo SIRE, ya validada al arrancar (plan de `export-sire-file`, "Configuración
 * del formato" y "Arquitectura": `SireConfig`). El spec pide tomar el formato de configuración, no fijarlo
 * en el código (FR-005).
 */
export type SireConfig = {
  /** El hotel, la ciudad, el separador (el carácter mismo), el formato de fecha y la codificación. */
  format: SireLineFormat;
  /** El fin de cada línea del archivo: `\r\n` (`CRLF`) o `\n` (`LF`). */
  lineBreak: '\r\n' | '\n';
  /** `SIRE_MAX_PERIOD_DAYS`: el máximo del periodo, en días. */
  maxPeriodDays: number;
  /** `SIRE_MAX_RECORDS`: el máximo de líneas de un archivo, para no agotar la memoria. */
  maxRecords: number;
};
