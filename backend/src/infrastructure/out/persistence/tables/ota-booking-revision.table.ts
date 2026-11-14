import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tabla `ota_booking_revision`, las revisiones de Channex ya procesadas (plan base). El esquema lo crean
 * las migraciones, no esta clase (D11).
 */
@Entity({ name: 'ota_booking_revision' })
export class OtaBookingRevisionTable {
  @PrimaryColumn({ name: 'revision_id', type: 'uuid' })
  revisionId: string;

  @Column({ name: 'ota_id', type: 'uuid' })
  otaId: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ type: 'varchar', length: 9 })
  status: string;

  /** Vacío si la revisión no se aplicó. */
  @Column({ name: 'reservation_id', type: 'uuid', nullable: true })
  reservationId: string | null;

  @Column({ type: 'varchar', length: 10 })
  result: string;

  /** Lo pone la base al insertar (`DEFAULT now()`). */
  @Column({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;

  /** Vacío hasta confirmar la revisión a Channex. */
  @Column({ name: 'acked_at', type: 'timestamptz', nullable: true })
  ackedAt: Date | null;
}
