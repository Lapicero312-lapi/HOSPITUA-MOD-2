import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T007 · Esquema base del Módulo 2 (plan base, "Modelo de datos base").
 *
 * Crea las 17 tablas con sus relaciones, restricciones e índices, las extensiones y la restricción
 * anti-solape de habitaciones (D3). Está escrita a mano en SQL (decisión D11), no generada desde clases.
 *
 * Lo que NO está aquí porque lo declaran como propio otros planes (cada uno lo agrega en su migración):
 *   - check-view-reservation: columna generada `guest.document_number_normalized`, índices sobre
 *     `lower(reservation_ref)`, `lower(external_confirmation_code)` y `reservation(start_date, end_date)`.
 *   - process-guest-data: columna generada `guest_data.document_number_normalized` y su índice.
 *   - update-reservation: índice `processed_message(queue, sequence_number)`.
 * Las extensiones, `immutable_unaccent` y los índices de búsqueda por nombre ya quedan creados aquí:
 * esas migraciones no deben volver a crearlos.
 */
export class EsquemaBase1792461934191 implements MigrationInterface {
  name = 'EsquemaBase1792461934191';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of SUBIDA) {
      await queryRunner.query(sql);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of BAJADA) {
      await queryRunner.query(sql);
    }
  }
}

const SUBIDA: string[] = [
  // --- Extensiones -------------------------------------------------------------------------------
  // btree_gist: la restricción anti-solape (D3). pg_trgm y unaccent: búsqueda por nombre.
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  `CREATE EXTENSION IF NOT EXISTS unaccent`,

  // ÚNICA diferencia con el plan base: el plan pide los índices de nombre de `guest` y `guest_data`
  // sobre unaccent(first_name || ' ' || last_name), pero PostgreSQL lo rechaza porque unaccent() no
  // es IMMUTABLE y en un índice solo se aceptan funciones IMMUTABLE. Se usa este envoltorio y la
  // expresión immutable_unaccent(lower(...)), que es la que define check-view-reservation
  // ("Índices y extensiones"), para que la búsqueda de ese caso de uso use el índice.
  `CREATE OR REPLACE FUNCTION immutable_unaccent(text)
     RETURNS text
     LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
     AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$`,

  // --- ota: la agencia (configure-ota) -----------------------------------------------------------
  `CREATE TABLE ota (
     id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
     name                  varchar(100)  NOT NULL CONSTRAINT uq_ota_name UNIQUE,
     hotel_account_id      varchar(100)  NOT NULL CONSTRAINT uq_ota_hotel_account_id UNIQUE,
     commission_percentage numeric(5,2)  NOT NULL
       CONSTRAINT ck_ota_commission_percentage CHECK (commission_percentage BETWEEN 0 AND 100),
     connection_status     varchar(12)   NOT NULL
       CONSTRAINT ck_ota_connection_status CHECK (connection_status IN ('CONNECTED', 'DISCONNECTED')),
     linked_at             timestamptz   NOT NULL,
     last_sync_at          timestamptz   NOT NULL,
     created_at            timestamptz   NOT NULL DEFAULT now(),
     updated_at            timestamptz   NOT NULL DEFAULT now()
   )`,

  // --- reservation: raíz del agregado ------------------------------------------------------------
  `CREATE TABLE reservation (
     id                         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_ref            char(12)       NOT NULL CONSTRAINT uq_reservation_reservation_ref UNIQUE
       CONSTRAINT ck_reservation_reservation_ref CHECK (reservation_ref ~ '^RSV-[0-9A-F]{8}$'),
     source                     varchar(6)     NOT NULL
       CONSTRAINT ck_reservation_source CHECK (source IN ('DIRECT', 'OTA')),
     ota_id                     uuid           CONSTRAINT fk_reservation_ota REFERENCES ota (id),
     external_confirmation_code varchar(50),
     start_date                 date           NOT NULL,
     end_date                   date           NOT NULL,
     guest_count                smallint       NOT NULL CONSTRAINT ck_reservation_guest_count CHECK (guest_count >= 1),
     status                     varchar(12)    NOT NULL CONSTRAINT ck_reservation_status
       CHECK (status IN ('PENDING', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
     status_reason              varchar(200),
     notes                      varchar(500),
     gross_amount               numeric(14,2),
     currency                   char(3),
     commission_percentage      numeric(5,2)   NOT NULL DEFAULT 0
       CONSTRAINT ck_reservation_commission_percentage CHECK (commission_percentage BETWEEN 0 AND 100),
     commission_amount          numeric(14,2)  NOT NULL DEFAULT 0
       CONSTRAINT ck_reservation_commission_amount CHECK (commission_amount >= 0),
     commission_status          varchar(10)    CONSTRAINT ck_reservation_commission_status
       CHECK (commission_status IN ('CALCULATED', 'RECONCILED', 'PAID')),
     conflict_reason            varchar(25)    CONSTRAINT ck_reservation_conflict_reason
       CHECK (conflict_reason IN ('NO_ROOM_AVAILABLE', 'CAPACITY_EXCEEDED', 'CHANGE_NOT_APPLICABLE')),
     conflict_detected_at       timestamptz,
     created_at                 timestamptz    NOT NULL DEFAULT now(),
     updated_at                 timestamptz(6) NOT NULL DEFAULT now(),
     CONSTRAINT ck_reservation_dates CHECK (end_date > start_date),
     CONSTRAINT uq_reservation_ota_confirmation UNIQUE (ota_id, external_confirmation_code),
     -- El conflicto va completo (motivo y fecha) o no va, y solo en reservas de Booking (D13).
     CONSTRAINT ck_reservation_conflict CHECK (
       (conflict_reason IS NULL AND conflict_detected_at IS NULL)
       OR (conflict_reason IS NOT NULL AND conflict_detected_at IS NOT NULL AND source = 'OTA')),
     -- Directa: sin agencia ni comisión. OTA: con agencia, código, valor bruto, moneda y estado de comisión.
     CONSTRAINT ck_reservation_channel CHECK (
       (source = 'DIRECT'
         AND ota_id IS NULL AND external_confirmation_code IS NULL AND gross_amount IS NULL
         AND currency IS NULL AND commission_status IS NULL
         AND commission_percentage = 0 AND commission_amount = 0)
       OR (source = 'OTA'
         AND ota_id IS NOT NULL AND external_confirmation_code IS NOT NULL AND gross_amount IS NOT NULL
         AND currency IS NOT NULL AND commission_status IS NOT NULL))
   )`,
  `CREATE INDEX ix_reservation_status_start_date ON reservation (status, start_date)`,
  `CREATE INDEX ix_reservation_end_date ON reservation (end_date)`,
  `CREATE INDEX ix_reservation_ota_id ON reservation (ota_id)`,
  `CREATE INDEX ix_reservation_external_confirmation_code ON reservation (external_confirmation_code)`,
  `CREATE INDEX ix_reservation_conflict ON reservation (conflict_detected_at) WHERE conflict_reason IS NOT NULL`,

  // --- guest: titular de una reserva (cada reserva tiene el suyo) ---------------------------------
  `CREATE TABLE guest (
     id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_id  uuid          NOT NULL CONSTRAINT uq_guest_reservation UNIQUE
       CONSTRAINT fk_guest_reservation REFERENCES reservation (id) ON DELETE CASCADE,
     first_name      varchar(100)  NOT NULL,
     last_name       varchar(100)  NOT NULL,
     document_type   varchar(3)    CONSTRAINT ck_guest_document_type
       CHECK (document_type IN ('RC', 'TI', 'CC', 'CE', 'PAS', 'NIT')),
     document_number varchar(30),
     nationality     varchar(60),
     contact_phone   varchar(30),
     contact_email   varchar(254),
     created_at      timestamptz   NOT NULL DEFAULT now(),
     updated_at      timestamptz   NOT NULL DEFAULT now(),
     -- Tipo y número de documento van juntos o ninguno (Booking no los envía).
     CONSTRAINT ck_guest_document CHECK ((document_type IS NULL) = (document_number IS NULL))
   )`,
  `CREATE INDEX ix_guest_document_number ON guest (document_number)`,
  `CREATE INDEX ix_guest_name_trgm ON guest
     USING gin (immutable_unaccent(lower(first_name || ' ' || last_name)) gin_trgm_ops)`,

  // --- reservation_room: habitación dentro de la reserva -----------------------------------------
  `CREATE TABLE reservation_room (
     id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_id    uuid           NOT NULL
       CONSTRAINT fk_reservation_room_reservation REFERENCES reservation (id) ON DELETE CASCADE,
     room_id           uuid,
     room_number       varchar(10),
     category_room     varchar(50)    NOT NULL,
     guest_count       smallint       NOT NULL CONSTRAINT ck_reservation_room_guest_count CHECK (guest_count >= 1),
     room_gross_amount numeric(14,2),
     quote_id          varchar(64),
     currency          char(3),
     stay_status       varchar(12)    NOT NULL DEFAULT 'EXPECTED' CONSTRAINT ck_reservation_room_stay_status
       CHECK (stay_status IN ('EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'NOT_ARRIVED')),
     start_date        date           NOT NULL,
     end_date          date           NOT NULL,
     blocks_inventory  boolean        NOT NULL,
     CONSTRAINT uq_reservation_room_room UNIQUE (reservation_id, room_id),
     -- La tarifa (solo reservas directas) va completa o no va.
     CONSTRAINT ck_reservation_room_rate CHECK (
       (room_gross_amount IS NULL) = (quote_id IS NULL) AND (quote_id IS NULL) = (currency IS NULL)),
     -- Habitación y número van juntos; sin habitación asignada no se bloquea inventario (D13).
     CONSTRAINT ck_reservation_room_assignment CHECK (
       (room_id IS NULL) = (room_number IS NULL) AND (room_id IS NOT NULL OR NOT blocks_inventory)),
     -- D3: dos estadías que bloquean inventario no pueden cruzarse en la misma habitación.
     -- '[)' deja que una salida y una llegada el mismo día no choquen.
     CONSTRAINT ex_reservation_room_no_overlap EXCLUDE USING gist (
       room_id WITH =,
       daterange(start_date, end_date, '[)') WITH &&
     ) WHERE (blocks_inventory)
   )`,
  `CREATE INDEX ix_reservation_room_room_id ON reservation_room (room_id)`,
  `CREATE INDEX ix_reservation_room_category_dates ON reservation_room (category_room, start_date, end_date)
     WHERE blocks_inventory`,

  // --- cancellation: registro inmutable de la anulación ------------------------------------------
  `CREATE TABLE cancellation (
     id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_id    uuid          NOT NULL CONSTRAINT uq_cancellation_reservation UNIQUE
       CONSTRAINT fk_cancellation_reservation REFERENCES reservation (id),
     cancellation_date timestamptz   NOT NULL,
     reason            varchar(500),
     channel           varchar(10)   NOT NULL
       CONSTRAINT ck_cancellation_channel CHECK (channel IN ('RECEPTION', 'OTA_API')),
     processed_by      varchar(100)  NOT NULL,
     status            varchar(10)   NOT NULL DEFAULT 'COMPLETED'
       CONSTRAINT ck_cancellation_status CHECK (status = 'COMPLETED')
   )`,

  // --- guest_data: datos de todos los huéspedes, una vez por reserva ------------------------------
  `CREATE TABLE guest_data (
     id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_id    uuid          NOT NULL CONSTRAINT fk_guest_data_reservation REFERENCES reservation (id),
     document_type     varchar(3)    NOT NULL CONSTRAINT ck_guest_data_document_type
       CHECK (document_type IN ('RC', 'TI', 'CC', 'CE', 'PAS', 'NIT')),
     document_number   varchar(30)   NOT NULL,
     first_name        varchar(100)  NOT NULL,
     last_name         varchar(100)  NOT NULL,
     birth_date        date          NOT NULL,
     nationality       varchar(60)   NOT NULL,
     origin_place      varchar(100),
     destination_place varchar(100),
     created_at        timestamptz   NOT NULL DEFAULT now(),
     -- Sin el tipo de documento a propósito: en el Check-Out el huésped se identifica por su número.
     CONSTRAINT uq_guest_data_reservation_document UNIQUE (reservation_id, document_number)
   )`,
  `CREATE INDEX ix_guest_data_document_number ON guest_data (document_number)`,
  `CREATE INDEX ix_guest_data_name_trgm ON guest_data
     USING gin (immutable_unaccent(lower(first_name || ' ' || last_name)) gin_trgm_ops)`,

  // --- migratory_movement: entrada o salida de un huésped -----------------------------------------
  `CREATE TABLE migratory_movement (
     id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
     guest_data_id uuid         NOT NULL
       CONSTRAINT fk_migratory_movement_guest_data REFERENCES guest_data (id),
     movement_type varchar(9)   NOT NULL
       CONSTRAINT ck_migratory_movement_type CHECK (movement_type IN ('ENTRY', 'DEPARTURE')),
     movement_date date         NOT NULL,
     created_at    timestamptz  NOT NULL DEFAULT now(),
     CONSTRAINT uq_migratory_movement_guest_type UNIQUE (guest_data_id, movement_type)
   )`,
  `CREATE INDEX ix_migratory_movement_date ON migratory_movement (movement_date)`,

  // --- sire_export: histórico de descargas del archivo SIRE ---------------------------------------
  `CREATE TABLE sire_export (
     id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
     export_date      timestamptz   NOT NULL DEFAULT now(),
     export_kind      varchar(15)   NOT NULL
       CONSTRAINT ck_sire_export_kind CHECK (export_kind IN ('PERIOD', 'SINGLE_MOVEMENT')),
     records_count    integer       NOT NULL CONSTRAINT ck_sire_export_records_count CHECK (records_count >= 0),
     date_range_start date,
     date_range_end   date,
     processed_by     varchar(100)  NOT NULL,
     -- Un movimiento: un registro y sin fechas. Un periodo: las dos fechas, en orden.
     CONSTRAINT ck_sire_export_range CHECK (
       (export_kind = 'SINGLE_MOVEMENT'
         AND records_count = 1 AND date_range_start IS NULL AND date_range_end IS NULL)
       OR (export_kind = 'PERIOD'
         AND date_range_start IS NOT NULL AND date_range_end IS NOT NULL
         AND date_range_start <= date_range_end))
   )`,

  // --- commission_audit: registro auditable de cada comisión --------------------------------------
  `CREATE TABLE commission_audit (
     id                    uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
     reservation_id        uuid           NOT NULL CONSTRAINT fk_commission_audit_reservation REFERENCES reservation (id),
     ota_id                uuid           NOT NULL CONSTRAINT fk_commission_audit_ota REFERENCES ota (id),
     action                varchar(12)    NOT NULL
       CONSTRAINT ck_commission_audit_action CHECK (action IN ('CALCULATED', 'RECONCILED', 'PAID')),
     previous_status       varchar(10)    CONSTRAINT ck_commission_audit_previous_status
       CHECK (previous_status IN ('CALCULATED', 'RECONCILED', 'PAID')),
     gross_amount          numeric(14,2)  NOT NULL,
     commission_percentage numeric(5,2)   NOT NULL,
     commission_amount     numeric(14,2)  NOT NULL,
     channel               varchar(10)    NOT NULL
       CONSTRAINT ck_commission_audit_channel CHECK (channel IN ('OTA_API', 'MODULE3')),
     performed_by          varchar(100)   NOT NULL,
     occurred_at           timestamptz    NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_commission_audit_reservation ON commission_audit (reservation_id)`,

  // --- daily_list_message: avisos al Módulo 1, guardados antes de publicarse ----------------------
  `CREATE TABLE daily_list_message (
     message_id       uuid         PRIMARY KEY,
     operational_date date         NOT NULL,
     sequence_number  integer      NOT NULL CONSTRAINT ck_daily_list_message_sequence CHECK (sequence_number >= 1),
     message_kind     varchar(6)   NOT NULL
       CONSTRAINT ck_daily_list_message_kind CHECK (message_kind IN ('LIST', 'UPDATE')),
     update_type      varchar(8)   CONSTRAINT ck_daily_list_message_update_type
       CHECK (update_type IN ('ADDED', 'UPDATED', 'REMOVED')),
     reservation_id   uuid         CONSTRAINT fk_daily_list_message_reservation REFERENCES reservation (id),
     removal_reason   varchar(15)  CONSTRAINT ck_daily_list_message_removal_reason
       CHECK (removal_reason IN ('CANCELLED', 'DATE_CHANGED', 'NO_SHOW', 'ROOM_UNASSIGNED')),
     payload          jsonb        NOT NULL,
     publish_status   varchar(9)   NOT NULL CONSTRAINT ck_daily_list_message_publish_status
       CHECK (publish_status IN ('PENDING', 'PUBLISHED', 'FAILED')),
     attempts         smallint     NOT NULL DEFAULT 0,
     created_at       timestamptz  NOT NULL DEFAULT now(),
     published_at     timestamptz,
     CONSTRAINT uq_daily_list_message_sequence UNIQUE (operational_date, sequence_number),
     -- LIST: sin tipo, reserva ni motivo. UPDATE: con tipo y reserva; el motivo va solo, y siempre, en REMOVED.
     CONSTRAINT ck_daily_list_message_shape CHECK (
       (message_kind = 'LIST'
         AND update_type IS NULL AND reservation_id IS NULL AND removal_reason IS NULL)
       OR (message_kind = 'UPDATE'
         AND update_type IS NOT NULL AND reservation_id IS NOT NULL
         AND ((update_type = 'REMOVED') = (removal_reason IS NOT NULL))))
   )`,
  // Una sola lista por día operativo.
  `CREATE UNIQUE INDEX uq_daily_list_message_one_list ON daily_list_message (operational_date)
     WHERE message_kind = 'LIST'`,
  `CREATE INDEX ix_daily_list_message_publish ON daily_list_message (publish_status, operational_date, sequence_number)`,

  // --- daily_sequence: numeración de los avisos del día -------------------------------------------
  `CREATE TABLE daily_sequence (
     operational_date date     PRIMARY KEY,
     last_sequence    integer  NOT NULL DEFAULT 0 CONSTRAINT ck_daily_sequence_last CHECK (last_sequence >= 0),
     list_generated   boolean  NOT NULL DEFAULT false
   )`,

  // --- processed_message: mensajes recibidos del Módulo 1 (idempotencia) --------------------------
  `CREATE TABLE processed_message (
     message_id      uuid         PRIMARY KEY,
     queue           varchar(60)  NOT NULL,
     sequence_number bigint       NOT NULL,
     processed_at    timestamptz  NOT NULL DEFAULT now()
   )`,

  // --- ota_room_type_mapping: tipos de habitación de Channex por categoría (de la propiedad) ------
  `CREATE TABLE ota_room_type_mapping (
     id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
     channex_room_type_id uuid         NOT NULL CONSTRAINT uq_ota_room_type_mapping_channex UNIQUE,
     category_room        varchar(50)  NOT NULL CONSTRAINT uq_ota_room_type_mapping_category UNIQUE,
     count_of_rooms       integer      NOT NULL
       CONSTRAINT ck_ota_room_type_mapping_count CHECK (count_of_rooms >= 1),
     occupancy            smallint     NOT NULL
   )`,

  // --- ota_booking_revision: revisiones de Channex ya procesadas ----------------------------------
  `CREATE TABLE ota_booking_revision (
     revision_id    uuid         PRIMARY KEY,
     ota_id         uuid         NOT NULL CONSTRAINT fk_ota_booking_revision_ota REFERENCES ota (id),
     booking_id     uuid         NOT NULL,
     status         varchar(9)   NOT NULL
       CONSTRAINT ck_ota_booking_revision_status CHECK (status IN ('new', 'modified', 'cancelled')),
     reservation_id uuid         CONSTRAINT fk_ota_booking_revision_reservation REFERENCES reservation (id),
     result         varchar(10)  NOT NULL
       CONSTRAINT ck_ota_booking_revision_result CHECK (result IN ('APPLIED', 'CONFLICT', 'IGNORED')),
     processed_at   timestamptz  NOT NULL DEFAULT now(),
     acked_at       timestamptz
   )`,
  `CREATE INDEX ix_ota_booking_revision_booking ON ota_booking_revision (booking_id)`,
  // Para repetir los ack que fallaron.
  `CREATE INDEX ix_ota_booking_revision_pending_ack ON ota_booking_revision (processed_at)
     WHERE acked_at IS NULL`,

  // --- ari_pending_change: disponibilidad pendiente de enviar a Channex ---------------------------
  `CREATE TABLE ari_pending_change (
     id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
     category_room varchar(50)  NOT NULL,
     date_from     date         NOT NULL,
     date_to       date         NOT NULL,
     created_at    timestamptz  NOT NULL DEFAULT now(),
     CONSTRAINT ck_ari_pending_change_dates CHECK (date_to > date_from)
   )`,

  // --- ota_no_show_report: no-shows de Booking pendientes de reportar a Channex (D15) ------------
  `CREATE TABLE ota_no_show_report (
     reservation_id uuid         PRIMARY KEY
       CONSTRAINT fk_ota_no_show_report_reservation REFERENCES reservation (id),
     booking_id     uuid         NOT NULL,
     result         varchar(8)   NOT NULL DEFAULT 'PENDING'
       CONSTRAINT ck_ota_no_show_report_result CHECK (result IN ('PENDING', 'REPORTED', 'REJECTED')),
     attempts       smallint     NOT NULL DEFAULT 0,
     created_at     timestamptz  NOT NULL DEFAULT now(),
     reported_at    timestamptz
   )`,
  `CREATE INDEX ix_ota_no_show_report_pending ON ota_no_show_report (created_at) WHERE result = 'PENDING'`,

  // --- idempotency_key: creaciones de reservas directas ya atendidas (D16) ------------------------
  `CREATE TABLE idempotency_key (
     key            uuid         PRIMARY KEY,
     request_hash   varchar(64)  NOT NULL,
     reservation_id uuid         NOT NULL CONSTRAINT fk_idempotency_key_reservation REFERENCES reservation (id),
     created_at     timestamptz  NOT NULL DEFAULT now()
   )`,
];

// Deshace todo en orden inverso: primero las tablas que dependen de otras.
const BAJADA: string[] = [
  `DROP TABLE IF EXISTS idempotency_key`,
  `DROP TABLE IF EXISTS ota_no_show_report`,
  `DROP TABLE IF EXISTS ari_pending_change`,
  `DROP TABLE IF EXISTS ota_booking_revision`,
  `DROP TABLE IF EXISTS ota_room_type_mapping`,
  `DROP TABLE IF EXISTS processed_message`,
  `DROP TABLE IF EXISTS daily_sequence`,
  `DROP TABLE IF EXISTS daily_list_message`,
  `DROP TABLE IF EXISTS commission_audit`,
  `DROP TABLE IF EXISTS sire_export`,
  `DROP TABLE IF EXISTS migratory_movement`,
  `DROP TABLE IF EXISTS guest_data`,
  `DROP TABLE IF EXISTS cancellation`,
  `DROP TABLE IF EXISTS reservation_room`,
  `DROP TABLE IF EXISTS guest`,
  `DROP TABLE IF EXISTS reservation`,
  `DROP TABLE IF EXISTS ota`,
  `DROP FUNCTION IF EXISTS immutable_unaccent(text)`,
  `DROP EXTENSION IF EXISTS unaccent`,
  `DROP EXTENSION IF EXISTS pg_trgm`,
  `DROP EXTENSION IF EXISTS btree_gist`,
];
