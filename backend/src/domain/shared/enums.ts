/** Enumerados del Módulo 2 (plan base, "Enumerados"). */

export const RESERVATION_STATUSES = [
  'PENDING',
  'ACTIVE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const STAY_STATUSES = [
  'EXPECTED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'NOT_ARRIVED',
] as const;
export type StayStatus = (typeof STAY_STATUSES)[number];

export const RESERVATION_SOURCES = ['DIRECT', 'OTA'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export const COMMISSION_STATUSES = [
  'CALCULATED',
  'RECONCILED',
  'PAID',
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const DOCUMENT_TYPES = ['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const MOVEMENT_TYPES = ['ENTRY', 'DEPARTURE'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Derivado: se calcula para mostrarlo y no se guarda. */
export const MIGRATION_STATUSES = [
  'AWAITING_CHECK_IN',
  'COMPLETE',
  'NOT_REQUIRED',
  'NO_CHECK_IN',
] as const;
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number];

/** Motivos de una reserva de Booking en conflicto (D13). */
export const CONFLICT_REASONS = [
  'NO_ROOM_AVAILABLE',
  'CAPACITY_EXCEEDED',
  'CHANGE_NOT_APPLICABLE',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** Motivo de la última transición de una reserva (D6, columna `status_reason`). */
export const STATUS_REASONS = [
  'CHECK_IN',
  'CHECK_OUT',
  'DAY_CLOSE_NO_SHOW',
  'DAY_CLOSE_PARTIAL',
  'OTA_CONFIRMED',
  'CANCELLED_BY_RECEPTION',
  'CANCELLED_BY_OTA',
] as const;
export type StatusReason = (typeof STATUS_REASONS)[number];

export const CONNECTION_STATUSES = ['CONNECTED', 'DISCONNECTED'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
