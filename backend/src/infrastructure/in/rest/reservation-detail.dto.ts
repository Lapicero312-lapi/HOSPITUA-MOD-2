import { ApiProperty } from '@nestjs/swagger';
import type { ReservationDetail } from '../../../application/use-cases/check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  colombiaTime,
  colombiaTimeWithMicroseconds,
} from '../../../application/use-cases/check-view-reservation/message-time.js';
import {
  CANCELLATION_CHANNELS,
  CONFLICT_REASONS,
  DOCUMENT_TYPES,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  STAY_STATUSES,
} from '../../../domain/shared/enums.js';
import { MoneyDto as MoneySchema } from './money.dto.js';

/*
 * El cuerpo de C3 (plan de `check-view-reservation`), tal como lo recibe la pantalla. Son clases, y no tipos,
 * para que OpenAPI lo describa (plan base, "Contratos REST"): lo usa la respuesta 201 de la creación de la
 * reserva directa (T017 de `generate-direct-reservation`, punto 13) y lo puede reutilizar la documentación
 * de `GET /api/reservations/{reservationRef}` (T037 de `check-view-reservation`).
 */

/** La reserva de Booking en conflicto: el motivo y desde cuándo (la misma forma que en C1). */
export class ReservationConflictDto {
  @ApiProperty({ enum: CONFLICT_REASONS, example: 'NO_ROOM_AVAILABLE' })
  reason: string;

  @ApiProperty({ type: String, format: 'date-time' })
  detectedAt: Date;
}

/** Una habitación de la reserva en C3. */
export class ReservationDetailRoomDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '`null` en una habitación de Booking sin asignar.',
  })
  roomId: string | null;

  @ApiProperty({ type: String, nullable: true, example: '201' })
  roomNumber: string | null;

  @ApiProperty({ example: 'DOBLE' })
  categoryRoom: string;

  @ApiProperty({ example: 2 })
  guestCount: number;

  @ApiProperty({
    type: MoneySchema,
    nullable: true,
    description: 'La tarifa, informativa; `null` en una reserva de Booking.',
  })
  roomGrossAmount: MoneyBody | null;

  @ApiProperty({ enum: STAY_STATUSES, example: 'EXPECTED' })
  stayStatus: string;
}

/** El titular de la reserva en C3. */
export class ReservationDetailGuestDto {
  @ApiProperty({ example: 'Valentina' })
  firstName: string;

  @ApiProperty({ example: 'Ospina' })
  lastName: string;

  @ApiProperty({
    type: String,
    enum: DOCUMENT_TYPES,
    nullable: true,
    example: 'CC',
  })
  documentType: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1144093552' })
  documentNumber: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Colombia' })
  nationality: string | null;

  @ApiProperty({ type: String, nullable: true, example: '+57 300 000 0000' })
  contactPhone: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'valentina@correo.com',
  })
  contactEmail: string | null;
}

/** La cancelación de la reserva en C3, si la tiene. */
export class ReservationDetailCancellationDto {
  @ApiProperty({
    description: 'En hora de Colombia, con segundos.',
    example: '2026-10-09T10:15:20-05:00',
  })
  cancellationDate: string;

  @ApiProperty({ enum: CANCELLATION_CHANNELS, example: 'RECEPTION' })
  channel: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'El huésped cambió de planes',
  })
  reason: string | null;

  @ApiProperty({ example: 'laura.mendez' })
  processedBy: string;
}

/** El cuerpo de C3 (plan de `check-view-reservation`), tal como lo recibe la pantalla. */
export class ReservationDetailDto {
  @ApiProperty({ pattern: '^RSV-[0-9A-F]{8}$', example: 'RSV-3F9A1C7B' })
  reservationRef: string;

  @ApiProperty({ enum: RESERVATION_STATUSES, example: 'ACTIVE' })
  status: string;

  @ApiProperty({ enum: RESERVATION_SOURCES, example: 'DIRECT' })
  source: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  externalConfirmationCode: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  otaName: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-12' })
  startDate: string;

  @ApiProperty({ format: 'date', example: '2026-10-15' })
  endDate: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ example: 4 })
  guestCount: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Llegada después de las 8 p. m.',
  })
  notes: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'En hora de Colombia, con segundos.',
    example: '2026-10-09T09:14:00-05:00',
  })
  createdAt: string | null;

  /** La versión de la reserva: lo que la pantalla envía al cancelar y al modificar. */
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'La versión de la reserva, en hora de Colombia y con microsegundos: lo que la pantalla envía al cancelar y al modificar.',
    example: '2026-10-09T09:14:00.123456-05:00',
  })
  updatedAt: string | null;

  @ApiProperty({ type: ReservationConflictDto, nullable: true })
  conflict: ReservationConflictDto | null;

  @ApiProperty({ type: [ReservationDetailRoomDto] })
  rooms: ReservationDetailRoomDto[];

  @ApiProperty({ type: ReservationDetailGuestDto })
  guest: ReservationDetailGuestDto;

  @ApiProperty({ type: ReservationDetailCancellationDto, nullable: true })
  cancellation: ReservationDetailCancellationDto | null;
}

/** El cuerpo de C3 (plan de `check-view-reservation`), tal como lo recibe la pantalla. */
export type ReservationDetailBody = ReservationDetailDto;

/** El dinero como texto decimal con dos decimales y su moneda (plan base, "Dinero"). */
type MoneyBody = { amount: string; currency: string };

/**
 * El cuerpo de C3 a partir de `GetReservationDetail` (plan, "`GetReservationDetail`"), sin reglas de
 * negocio: el dinero va como texto con dos decimales, `createdAt` y `cancellationDate` en hora de Colombia
 * con segundos, una habitación sin asignar con `roomId` y `roomNumber` en `null`, y `notes` tal cual.
 * `conflict` tiene la misma forma que en C1.
 */
export function toReservationDetailBody({
  reservation,
  nights,
  otaName,
  cancellation,
}: ReservationDetail): ReservationDetailBody {
  const { guest, conflict, createdAt, updatedAt } = reservation;
  return {
    reservationRef: reservation.reservationRef,
    status: reservation.status,
    source: reservation.source,
    externalConfirmationCode: reservation.ota?.externalConfirmationCode ?? null,
    otaName,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    nights,
    guestCount: reservation.guestCount,
    notes: reservation.notes,
    createdAt: createdAt === null ? null : colombiaTime(createdAt),
    // Con sus microsegundos: es el control de concurrencia de cancelar y modificar.
    updatedAt:
      updatedAt === null ? null : colombiaTimeWithMicroseconds(updatedAt),
    conflict:
      conflict === null
        ? null
        : { reason: conflict.reason, detectedAt: conflict.detectedAt },
    rooms: reservation.rooms.map((room) => ({
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      categoryRoom: room.categoryRoom,
      guestCount: room.guestCount,
      roomGrossAmount:
        room.rate === null ? null : moneyBody(room.rate.roomGrossAmount),
      stayStatus: room.stayStatus,
    })),
    guest: {
      firstName: guest.firstName,
      lastName: guest.lastName,
      documentType: guest.documentType,
      documentNumber: guest.documentNumber,
      nationality: guest.nationality,
      contactPhone: guest.contactPhone,
      contactEmail: guest.contactEmail,
    },
    cancellation:
      cancellation === null
        ? null
        : {
            cancellationDate: colombiaTime(cancellation.cancellationDate),
            channel: cancellation.channel,
            reason: cancellation.reason,
            processedBy: cancellation.processedBy,
          },
  };
}

/** El importe de una habitación (`Money`): solo lo que hace falta para el cuerpo. */
function moneyBody(money: {
  amountWithCents: string;
  currency: string;
}): MoneyBody {
  return { amount: money.amountWithCents, currency: money.currency };
}
