import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Tabla `ari_pending_change`, la disponibilidad pendiente de enviar a Channex (plan base). El esquema lo
 * crean las migraciones, no esta clase (D11).
 */
@Entity({ name: 'ari_pending_change' })
export class AriPendingChangeTable {
  /** Lo pone la base al insertar (`DEFAULT gen_random_uuid()`). */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'category_room', type: 'varchar', length: 50 })
  categoryRoom: string;

  @Column({ name: 'date_from', type: 'date' })
  dateFrom: string;

  @Column({ name: 'date_to', type: 'date' })
  dateTo: string;

  /** Lo pone la base al insertar (`DEFAULT now()`). */
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
