import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Tabla `ota`, la agencia (plan base). El esquema lo crean las migraciones, no esta clase (D11). */
@Entity({ name: 'ota' })
export class OtaTable {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Vacío hasta la primera reserva de la agencia. */
  @Column({
    name: 'commission_percentage',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  commissionPercentage: string | null;

  @Column({ name: 'connection_status', type: 'varchar', length: 12 })
  connectionStatus: string;

  @Column({ name: 'linked_at', type: 'timestamptz' })
  linkedAt: Date;

  @Column({ name: 'last_sync_at', type: 'timestamptz' })
  lastSyncAt: Date;
}
