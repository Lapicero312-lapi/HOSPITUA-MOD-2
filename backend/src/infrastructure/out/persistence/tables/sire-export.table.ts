import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tabla `sire_export`, el histórico de descargas del archivo SIRE (plan base). El esquema lo crean las
 * migraciones, no esta clase (D11).
 */
@Entity({ name: 'sire_export' })
export class SireExportTable {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'export_date', type: 'timestamptz' })
  exportDate: Date;

  @Column({ name: 'export_kind', type: 'varchar', length: 15 })
  exportKind: string;

  @Column({ name: 'records_count', type: 'integer' })
  recordsCount: number;

  /** Solo en `PERIOD`. */
  @Column({ name: 'date_range_start', type: 'date', nullable: true })
  dateRangeStart: string | null;

  /** Solo en `PERIOD`. */
  @Column({ name: 'date_range_end', type: 'date', nullable: true })
  dateRangeEnd: string | null;

  @Column({ name: 'processed_by', type: 'varchar', length: 100 })
  processedBy: string;
}
