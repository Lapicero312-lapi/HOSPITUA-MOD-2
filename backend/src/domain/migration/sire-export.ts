/** `PERIOD`: un periodo; `SINGLE_MOVEMENT`: la descarga individual (plan base, `sire_export.export_kind`). */
export type SireExportKind = 'PERIOD' | 'SINGLE_MOVEMENT';

export type SireExportProps = {
  /** El `exportId`, que viaja en la cabecera `Export-Id`. */
  id: string;
  /** Fecha y hora de la descarga. */
  exportDate: Date;
  exportKind: SireExportKind;
  /** Las líneas del archivo: `1` en la descarga individual. */
  recordsCount: number;
  /** `AAAA-MM-DD`, solo en `PERIOD`. */
  dateRangeStart: string | null;
  /** `AAAA-MM-DD`, solo en `PERIOD`. */
  dateRangeEnd: string | null;
  /** La Recepcionista que la ejecutó: el nombre que llega en `X-User`. */
  processedBy: string;
};

/**
 * Una descarga del archivo SIRE (plan base, "SireExport"; spec de `export-sire-file`, FR-007). Es
 * inmutable y no se borra: es el registro auditable de cada descarga (punto 11). No marca los movimientos
 * (D7). La coherencia entre el tipo, la cantidad y las fechas la garantizan las restricciones `CHECK` de
 * `sire_export`.
 */
export class SireExport {
  private constructor(private readonly props: SireExportProps) {}

  static restore(props: SireExportProps): SireExport {
    return new SireExport({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get exportDate(): Date {
    return this.props.exportDate;
  }

  get exportKind(): SireExportKind {
    return this.props.exportKind;
  }

  get recordsCount(): number {
    return this.props.recordsCount;
  }

  get dateRangeStart(): string | null {
    return this.props.dateRangeStart;
  }

  get dateRangeEnd(): string | null {
    return this.props.dateRangeEnd;
  }

  get processedBy(): string {
    return this.props.processedBy;
  }

  /** Una copia de sus datos, para guardarla. */
  snapshot(): SireExportProps {
    return { ...this.props };
  }
}
