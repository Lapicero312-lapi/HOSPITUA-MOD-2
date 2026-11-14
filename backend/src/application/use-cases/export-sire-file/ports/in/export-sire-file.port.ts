/** Símbolo con el que Nest inyecta el servicio en `SireController` (plan base, regla 4). */
export const EXPORT_SIRE_FILE = Symbol('EXPORT_SIRE_FILE');

/**
 * Lo que se pide exportar, ya revisado por `readSireExportRequest` (plan, contrato A): un periodo
 * (`AAAA-MM-DD`, los dos días incluidos) o un solo movimiento.
 */
export type SireExportRequest =
  | { exportKind: 'PERIOD'; startDate: string; endDate: string }
  | { exportKind: 'SINGLE_MOVEMENT'; movementId: string };

/** El archivo ya generado y registrado. */
export type SireFile = {
  /** El `id` de la `SireExport` registrada: viaja en la cabecera `Export-Id`. */
  exportId: string;
  /** `SIRE_<exportId>.txt`, para `Content-Disposition`. */
  fileName: string;
  /** Una línea por movimiento, cada una con su fin de línea. Lo codifica quien lo envía. */
  content: string;
  /** Las líneas del archivo: `1` en la descarga individual. */
  recordsCount: number;
};

/** La exportación del archivo SIRE (plan de `export-sire-file`, contrato A, D1 y D2). */
export interface ExportSireFile {
  /**
   * Arma el archivo completo en memoria y, solo si sale entero, registra la `SireExport` (regla 7).
   * @param processedBy La Recepcionista que lo pide (`X-User`), para `processed_by`.
   * @throws BusinessError `NO_MIGRATORY_MOVEMENTS`, `PERIOD_TOO_LARGE`, `MOVEMENT_NOT_FOUND` o
   * `INVALID_GUEST_CHARACTERS`; en ese caso no queda ninguna `SireExport`.
   */
  execute(request: SireExportRequest, processedBy: string): Promise<SireFile>;
}
