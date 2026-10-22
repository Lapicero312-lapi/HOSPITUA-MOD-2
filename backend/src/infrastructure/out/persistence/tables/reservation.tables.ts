import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';

// Las tres tablas del agregado Reservation van juntas: se relacionan entre sí y, en archivos
// separados, se importarían en círculo.

/** Tabla `reservation` (plan base). El esquema lo crean las migraciones, no esta clase (D11). */
@Entity({ name: 'reservation' })
export class ReservationTable {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'reservation_ref', type: 'char', length: 12 })
  reservationRef: string;

  @Column({ type: 'varchar', length: 6 })
  source: string;

  @Column({ name: 'ota_id', type: 'uuid', nullable: true })
  otaId: string | null;

  @Column({
    name: 'external_confirmation_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  externalConfirmationCode: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'guest_count', type: 'smallint' })
  guestCount: number;

  @Column({ type: 'varchar', length: 12 })
  status: string;

  @Column({
    name: 'status_reason',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  statusReason: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({
    name: 'gross_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  grossAmount: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  currency: string | null;

  @Column({
    name: 'commission_percentage',
    type: 'numeric',
    precision: 5,
    scale: 2,
  })
  commissionPercentage: string;

  @Column({
    name: 'commission_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
  })
  commissionAmount: string;

  @Column({
    name: 'commission_status',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  commissionStatus: string | null;

  @Column({
    name: 'conflict_reason',
    type: 'varchar',
    length: 25,
    nullable: true,
  })
  conflictReason: string | null;

  @Column({ name: 'conflict_detected_at', type: 'timestamptz', nullable: true })
  conflictDetectedAt: Date | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    insert: false,
    update: false,
  })
  createdAt: Date;

  /**
   * Es `timestamptz(6)` en la base, pero se declara como texto a propósito: TypeORM convierte las fechas
   * con hora en `Date`, que solo guarda milisegundos, y el control de concurrencia compara los
   * microsegundos. La base la fija en cada cambio (`now()`), nunca TypeORM.
   */
  @Column({ name: 'updated_at', type: 'text', insert: false, update: false })
  updatedAt: string;

  @OneToMany(() => ReservationRoomTable, (room) => room.reservation)
  rooms: Relation<ReservationRoomTable>[];

  @OneToOne(() => GuestTable, (guest) => guest.reservation)
  guest: Relation<GuestTable>;
}

/** Tabla `reservation_room` (plan base). El esquema lo crean las migraciones, no esta clase (D11). */
@Entity({ name: 'reservation_room' })
export class ReservationRoomTable {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId: string;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'room_number', type: 'varchar', length: 10, nullable: true })
  roomNumber: string | null;

  @Column({ name: 'category_room', type: 'varchar', length: 50 })
  categoryRoom: string;

  @Column({ name: 'guest_count', type: 'smallint' })
  guestCount: number;

  @Column({
    name: 'room_gross_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  roomGrossAmount: string | null;

  @Column({ name: 'quote_id', type: 'varchar', length: 64, nullable: true })
  quoteId: string | null;

  @Column({ type: 'char', length: 3, nullable: true })
  currency: string | null;

  @Column({ name: 'stay_status', type: 'varchar', length: 12 })
  stayStatus: string;

  /** Copia de las fechas de la reserva, para la restricción anti-solape (D3). */
  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  /** D3: `true` mientras la habitación ocupa inventario. */
  @Column({ name: 'blocks_inventory', type: 'boolean' })
  blocksInventory: boolean;

  @ManyToOne(() => ReservationTable, (reservation) => reservation.rooms)
  @JoinColumn({ name: 'reservation_id' })
  reservation: Relation<ReservationTable>;
}

/** Tabla `guest`, el titular de una reserva (plan base). El esquema lo crean las migraciones (D11). */
@Entity({ name: 'guest' })
export class GuestTable {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Column({ name: 'document_type', type: 'varchar', length: 3, nullable: true })
  documentType: string | null;

  @Column({
    name: 'document_number',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  documentNumber: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  nationality: string | null;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  contactPhone: string | null;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 254,
    nullable: true,
  })
  contactEmail: string | null;

  @OneToOne(() => ReservationTable, (reservation) => reservation.guest)
  @JoinColumn({ name: 'reservation_id' })
  reservation: Relation<ReservationTable>;
}
