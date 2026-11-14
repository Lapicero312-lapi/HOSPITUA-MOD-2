import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Guest } from '../../../domain/guest/guest.js';
import { assignRooms } from '../../../domain/reservation/assign-rooms.js';
import {
  type OtaRoomInput,
  Reservation,
} from '../../../domain/reservation/reservation.js';
import { newReservationRef } from '../../../domain/reservation/reservation-ref.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import { CONCURRENT_UPDATE } from '../../../domain/shared/error-codes.js';
import type { BookingRevision } from '../../integration/booking-revision.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  DuplicateOtaBookingRevisionError,
  OTA_BOOKING_REVISION_REPOSITORY,
  type OtaBookingRevisionRepository,
  type OtaBookingRevisionResult,
} from '../../ports/out/ota-booking-revision.repository.js';
import {
  OTA_ROOM_TYPE_MAPPING_REPOSITORY,
  type OtaRoomTypeMappingRepository,
} from '../../ports/out/ota-room-type-mapping.repository.js';
import {
  DuplicateReservationRefError,
  RESERVATION_REPOSITORY,
  type ReservationRepository,
  RoomOverlapError,
} from '../../ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type Transaction,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  CANCEL_RESERVATION,
  type CancelReservation,
} from '../cancel-reservation/ports/in/cancel-reservation.port.js';
import {
  VERIFY_AVAILABILITY,
  type AvailabilityResult,
  type VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from '../configure-ota/ports/in/ari-change-recorder.port.js';
import { BOOKING_OTA_NAME } from '../configure-ota/ports/in/ensure-channex-setup.port.js';
import {
  MANAGE_OTA,
  type ManageOta,
} from '../register-ota-information-commission/ports/in/manage-ota.port.js';
import {
  type CommissionResult,
  REGISTER_OTA_CONFIRMATION_AND_COMMISSION,
  type RegisterOtaConfirmationAndCommission,
} from '../register-ota-information-commission/ports/in/register-ota-confirmation-and-commission.port.js';
import {
  APPLY_OTA_CHANGE,
  type ApplyOtaChange,
  type OtaChangePlan,
} from '../update-reservation/ports/in/apply-ota-change.port.js';
import {
  mapBookingRevision,
  type OtaReservationData,
} from './booking-revision.mapper.js';
import type {
  ProcessBookingRevision,
  RevisionOutcome,
} from './ports/in/process-booking-revision.port.js';

/** Intentos con una referencia distinta antes de rendirse (regla 7 del plan de `generate-direct-reservation`). */
const MAX_REFERENCE_ATTEMPTS = 5;

/** `processedBy` de la cancelación de Booking (punto 3 de "Puntos que este plan propone"). */
const BOOKING_PROCESSED_BY = 'Booking.com';

/** Los estados en los que Booking ya no puede cancelar: se marca el conflicto (B3). */
const NOT_CANCELLABLE_BY_BOOKING = ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

/** Los estados en los que se aplica un cambio de Booking; en los demás se marca el conflicto (B2). */
const CHANGEABLE_BY_BOOKING = ['ACTIVE', 'PENDING'];

const ACKNOWLEDGE: RevisionOutcome = { kind: 'ACKNOWLEDGE' };
const retry = (reason: string): RevisionOutcome => ({ kind: 'RETRY', reason });

/** Una habitación de la revisión ya relacionada con su categoría (paso 3 de B1). */
type MappedRoom = { categoryRoom: string; guestCount: number };

/**
 * `ProcessBookingRevision` (plan de `generate-ota-reservation`, B1, B2, B3 y punto 9). Las lecturas y las
 * llamadas a los otros módulos van antes de abrir la transacción; dentro solo se escribe (regla 6 del plan
 * base).
 */
@Injectable()
export class ProcessBookingRevisionService implements ProcessBookingRevision {
  private readonly logger = new Logger(ProcessBookingRevisionService.name);

  constructor(
    @Inject(OTA_BOOKING_REVISION_REPOSITORY)
    private readonly revisions: OtaBookingRevisionRepository,
    @Inject(MANAGE_OTA)
    private readonly otas: ManageOta,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(OTA_ROOM_TYPE_MAPPING_REPOSITORY)
    private readonly mappings: OtaRoomTypeMappingRepository,
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(REGISTER_OTA_CONFIRMATION_AND_COMMISSION)
    private readonly commission: RegisterOtaConfirmationAndCommission,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly availabilityChanges: AriChangeRecorder,
    @Inject(CANCEL_RESERVATION)
    private readonly cancellation: CancelReservation,
    @Inject(APPLY_OTA_CHANGE)
    private readonly otaChanges: ApplyOtaChange,
  ) {}

  async process(revision: BookingRevision): Promise<RevisionOutcome> {
    // Paso 1: una revisión ya procesada solo se vuelve a confirmar.
    if ((await this.revisions.findById(revision.id)) !== null) {
      return ACKNOWLEDGE;
    }
    // Paso 2: el mapeador; una ilegible queda en el feed.
    const data = mapBookingRevision(revision);
    if ('reason' in data) {
      return retry(`revisión ${revision.id} ilegible: ${data.reason}`);
    }
    const now = this.clock.now();
    const { id: otaId } = await this.otas.register(
      { name: BOOKING_OTA_NAME },
      now,
    );
    // Paso 3: la reserva de esa revisión, si ya existe.
    const existing = await this.reservations.findByOtaConfirmationCode(
      otaId,
      data.externalConfirmationCode,
    );

    // Paso 4.
    if (revision.status === 'cancelled') {
      return this.cancel(revision, otaId, existing, now);
    }
    if (existing !== null) {
      // Una `new` de una reserva que ya existe se trata como `modified` (paso 2 de B1).
      return this.modify(revision, data, otaId, existing, now);
    }
    // Una `modified` de una reserva desconocida se procesa como `new` (punto 1).
    return this.create(revision, data, otaId, now);
  }

  /** B1, pasos 3 a 10 (T006 y T011c). */
  private async create(
    revision: BookingRevision,
    data: OtaReservationData,
    otaId: string,
    receivedAt: Date,
  ): Promise<RevisionOutcome> {
    const rooms = await this.mapRooms(data);
    if (rooms === null) {
      return retry(
        `revisión ${revision.id}: una habitación sin relación con una categoría (configure-ota)`,
      );
    }
    // Paso 4: fechas distintas por habitación (FR-012, T011c).
    const datesDifferPerRoom = differPerRoom(data);
    // Paso 5: una verificación por categoría y la de menor `roomNumber`, sin repetir.
    const roomInputs = await this.assign(rooms, data);

    // Paso 6: la comisión, antes de crear la reserva.
    let result: CommissionResult;
    try {
      result = await this.commission.calculate({
        otaId,
        grossAmount: data.grossAmount,
        reportedCommission: data.otaCommission,
        externalConfirmationCode: data.externalConfirmationCode,
      });
    } catch (error) {
      if (error instanceof BusinessError) {
        this.logger.warn(
          `La revisión ${revision.id} no se guardó por la comisión: ${error.errorCode}. Queda en el feed.`,
        );
        return retry(`revisión ${revision.id}: ${error.errorCode}`);
      }
      throw error;
    }

    const guest = Guest.restore({ id: randomUUID(), ...data.guest });
    const categories = [...new Set(rooms.map((room) => room.categoryRoom))];
    try {
      await this.withNewReference((reservationRef) =>
        this.transactions.run(async (tx) => {
          if (result.learnedPercentage) {
            await this.otas.setCommissionPercentage(
              tx,
              otaId,
              result.commissionPercentage,
            );
          }
          // Paso 7: la reserva con su comisión y su auditoría. El paso 8 (el conflicto) lo marca createOta.
          const saved = await this.reservations.insert(
            Reservation.createOta({
              reservationRef,
              startDate: data.startDate,
              endDate: data.endDate,
              guest,
              notes: data.notes,
              ota: {
                otaId,
                externalConfirmationCode: data.externalConfirmationCode,
                grossAmount: data.grossAmount,
                commissionPercentage: result.commissionPercentage,
                commissionAmount: result.commissionAmount,
                commissionStatus: result.commissionStatus,
              },
              receivedAt,
              rooms: roomInputs,
              datesDifferPerRoom,
            }),
            tx,
          );
          await this.commission.recordAudit(
            tx,
            saved.id,
            result,
            BOOKING_PROCESSED_BY,
          );
          // Paso 9: los avisos. Con una habitación sin asignar, la reserva no entra a la lista.
          await this.dailyList.record(tx, null, saved);
          await this.availabilityChanges.record(
            tx,
            categories.map((categoryRoom) => ({
              categoryRoom,
              dateFrom: data.startDate,
              dateTo: data.endDate,
            })),
          );
          // Paso 10.
          await this.record(
            tx,
            revision,
            otaId,
            saved.id,
            saved.conflict === null ? 'APPLIED' : 'CONFLICT',
          );
        }),
      );
    } catch (error) {
      if (error instanceof RoomOverlapError) {
        return retry(
          `revisión ${revision.id}: otra reserva tomó una habitación al guardar`,
        );
      }
      if (error instanceof DuplicateOtaBookingRevisionError) {
        return ACKNOWLEDGE;
      }
      throw error;
    }
    return ACKNOWLEDGE;
  }

  /** B3 (T010): la cancelación de Booking. */
  private async cancel(
    revision: BookingRevision,
    otaId: string,
    existing: Reservation | null,
    now: Date,
  ): Promise<RevisionOutcome> {
    try {
      await this.transactions.run(async (tx) => {
        if (existing === null || existing.status === 'CANCELLED') {
          await this.record(
            tx,
            revision,
            otaId,
            existing?.id ?? null,
            'IGNORED',
          );
          return;
        }
        if (NOT_CANCELLABLE_BY_BOOKING.includes(existing.status)) {
          await this.markNotApplicable(tx, revision, otaId, existing, now);
          return;
        }
        await this.cancellation.cancel(tx, {
          reservationRef: existing.reservationRef,
          channel: 'OTA_API',
          processedBy: BOOKING_PROCESSED_BY,
          reason: null,
        });
        await this.record(tx, revision, otaId, existing.id, 'APPLIED');
      });
    } catch (error) {
      if (error instanceof DuplicateOtaBookingRevisionError) {
        return ACKNOWLEDGE;
      }
      throw error;
    }
    return ACKNOWLEDGE;
  }

  /**
   * B2 (T009): el cambio de Booking, con `ApplyOtaChange` de `update-reservation`. `prepare` consulta el
   * Módulo 1 antes de la transacción; dentro, `apply` solo escribe. Si la reserva cambió entre medio, o la
   * restricción anti-solape rechaza una habitación, la revisión queda en el feed y se vuelve a preparar en la
   * siguiente lectura.
   */
  private async modify(
    revision: BookingRevision,
    data: OtaReservationData,
    otaId: string,
    existing: Reservation,
    now: Date,
  ): Promise<RevisionOutcome> {
    try {
      if (!CHANGEABLE_BY_BOOKING.includes(existing.status)) {
        await this.transactions.run((tx) =>
          this.markNotApplicable(tx, revision, otaId, existing, now),
        );
        return ACKNOWLEDGE;
      }
      const rooms = await this.mapRooms(data);
      if (rooms === null) {
        return retry(
          `revisión ${revision.id}: una habitación sin relación con una categoría (configure-ota)`,
        );
      }
      let plan: OtaChangePlan;
      try {
        plan = await this.otaChanges.prepare(existing, {
          startDate: data.startDate,
          endDate: data.endDate,
          rooms,
          grossAmount: data.grossAmount,
          notes: data.notes,
          guest: {
            firstName: data.guest.firstName,
            lastName: data.guest.lastName,
            contactEmail: data.guest.contactEmail,
            contactPhone: data.guest.contactPhone,
            nationality: data.guest.nationality,
          },
          datesDifferPerRoom: differPerRoom(data),
        });
      } catch (error) {
        if (error instanceof BusinessError) {
          this.logger.warn(
            `La revisión ${revision.id} no se aplicó: ${error.errorCode}. Queda en el feed.`,
          );
          return retry(`revisión ${revision.id}: ${error.errorCode}`);
        }
        throw error;
      }
      await this.transactions.run(async (tx) => {
        const saved = await this.otaChanges.apply(tx, plan);
        await this.record(
          tx,
          revision,
          otaId,
          saved.id,
          saved.conflict === null ? 'APPLIED' : 'CONFLICT',
        );
      });
    } catch (error) {
      if (error instanceof RoomOverlapError) {
        return retry(
          `revisión ${revision.id}: otra reserva tomó una habitación al guardar`,
        );
      }
      if (
        error instanceof BusinessError &&
        error.errorCode === CONCURRENT_UPDATE.code
      ) {
        return retry(
          `revisión ${revision.id}: la reserva cambió mientras se preparaba el cambio`,
        );
      }
      if (error instanceof DuplicateOtaBookingRevisionError) {
        return ACKNOWLEDGE;
      }
      throw error;
    }
    return ACKNOWLEDGE;
  }

  /**
   * Un cambio o una cancelación que no se puede aplicar por el estado de la reserva: se marca
   * `CHANGE_NOT_APPLICABLE` y la revisión queda `CONFLICT` (B2 y B3).
   */
  private async markNotApplicable(
    tx: Transaction,
    revision: BookingRevision,
    otaId: string,
    existing: Reservation,
    now: Date,
  ): Promise<void> {
    await this.reservations.update(
      existing.withConflict('CHANGE_NOT_APPLICABLE', now),
      tx,
    );
    await this.record(tx, revision, otaId, existing.id, 'CONFLICT');
  }

  /**
   * Paso 3: la categoría de cada habitación por su tipo de Channex. `null` si falta una relación o el tipo
   * llega vacío: la revisión queda en el feed hasta que `configure-ota` la complete.
   */
  private async mapRooms(
    data: OtaReservationData,
  ): Promise<MappedRoom[] | null> {
    const mapped: MappedRoom[] = [];
    for (const room of data.rooms) {
      if (room.channexRoomTypeId === null) {
        return null;
      }
      const mapping = await this.mappings.findByChannexRoomType(
        room.channexRoomTypeId,
      );
      if (mapping === null) {
        return null;
      }
      mapped.push({
        categoryRoom: mapping.categoryRoom,
        guestCount: room.guestCount,
      });
    }
    return mapped;
  }

  /** Paso 5: una verificación por categoría y, en orden, la libre de menor `roomNumber` sin repetir. */
  private async assign(
    rooms: readonly MappedRoom[],
    data: OtaReservationData,
  ): Promise<OtaRoomInput[]> {
    const byCategory = new Map<string, AvailabilityResult>();
    for (const categoryRoom of new Set(
      rooms.map((room) => room.categoryRoom),
    )) {
      byCategory.set(
        categoryRoom,
        await this.availability.check({
          startDate: data.startDate,
          endDate: data.endDate,
          categoryRoom,
        }),
      );
    }
    const taken: string[] = [];
    return rooms.map(({ categoryRoom, guestCount }) => {
      const result = byCategory.get(categoryRoom) as AvailabilityResult;
      const [room] = assignRooms(result, 1, taken);
      if (room === undefined) {
        // Sin lugar, queda sin asignar: la reserva se guarda en conflicto (D13).
        return { categoryRoom, guestCount, assigned: null };
      }
      taken.push(room.id);
      return {
        categoryRoom,
        guestCount,
        assigned: {
          roomId: room.id,
          roomNumber: room.roomNumber,
          maxCapacity: room.maxCapacity,
        },
      };
    });
  }

  /** Paso 10: la revisión, en la transacción del cambio. */
  private record(
    tx: Transaction,
    revision: BookingRevision,
    otaId: string,
    reservationId: string | null,
    result: OtaBookingRevisionResult,
  ): Promise<void> {
    return this.revisions.record(
      {
        revisionId: revision.id,
        otaId,
        bookingId: revision.bookingId,
        status: revision.status,
        reservationId,
        result,
      },
      tx,
    );
  }

  /** Con una referencia nueva y, si ya existe, con otra, hasta 5 intentos, cada uno en su transacción. */
  private async withNewReference(
    save: (reservationRef: string) => Promise<void>,
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await save(newReservationRef());
      } catch (error) {
        if (
          !(error instanceof DuplicateReservationRefError) ||
          attempt >= MAX_REFERENCE_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }
}

/** Alguna habitación trae `checkinDate` o `checkoutDate` distintos de las fechas de la reserva (FR-012). */
function differPerRoom(data: OtaReservationData): boolean {
  return data.rooms.some(
    (room) =>
      room.checkinDate !== data.startDate || room.checkoutDate !== data.endDate,
  );
}
