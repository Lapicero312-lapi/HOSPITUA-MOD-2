import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Guest } from '../../../domain/guest/guest.js';
import {
  type DirectRoomInput,
  Reservation,
} from '../../../domain/reservation/reservation.js';
import { Money } from '../../../domain/shared/money.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../integration/room-quote.js';
import { CLOCK, type Clock } from '../../ports/out/clock.js';
import {
  DuplicateIdempotencyKeyError,
  IDEMPOTENCY_KEY_REPOSITORY,
  type IdempotencyKeyRepository,
  type StoredIdempotencyKey,
} from '../../ports/out/idempotency-key.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import {
  TRANSACTION_RUNNER,
  type TransactionRunner,
} from '../../ports/out/transaction.js';
import {
  CALCULATE_DYNAMIC_RATE,
  type CalculateDynamicRate,
} from '../calculate-dynamic-rate/ports/in/calculate-dynamic-rate.port.js';
import {
  VERIFY_AVAILABILITY,
  type VerifyAvailability,
} from '../check-room-availability/ports/in/verify-availability.port.js';
import {
  GET_RESERVATION_DETAIL,
  type GetReservationDetail,
  type ReservationDetail,
} from '../check-view-reservation/ports/in/get-reservation-detail.port.js';
import {
  DAILY_LIST_CHANGE_RECORDER,
  type DailyListChangeRecorder,
} from '../check-view-reservation/ports/in/daily-list-change-recorder.port.js';
import {
  ARI_CHANGE_RECORDER,
  type AriChangeRecorder,
} from '../configure-ota/ports/in/ari-change-recorder.port.js';
import { assignDirectRooms } from './assign-direct-rooms.js';
import { readCreationRequest } from './direct-reservation-request.validator.js';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  IDEMPOTENCY_KEY_REQUIRED,
  IDEMPOTENCY_KEY_REUSED,
} from './error-codes.js';
import type { CreateDirectReservation } from './ports/in/create-direct-reservation.port.js';
import type { AssignedRoom } from './ports/in/preview-direct-reservation.port.js';
import { withNewReservationRef } from './with-new-reservation-ref.js';

/**
 * La creación de una reserva directa (plan, B, D2 y punto 12; T008). Las llamadas a los Módulos 1 y 3 van
 * antes de abrir la transacción; dentro solo está la inserción (punto 5 de "Puntos que este plan
 * propone"), con los avisos a la lista del día y a Channex (T010) y la `Idempotency-Key` (punto 15, T019).
 * El reintento ante un solape lo agrega T009.
 */
@Injectable()
export class CreateDirectReservationService implements CreateDirectReservation {
  constructor(
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(VERIFY_AVAILABILITY)
    private readonly availability: VerifyAvailability,
    @Inject(CALCULATE_DYNAMIC_RATE)
    private readonly rates: CalculateDynamicRate,
    @Inject(TRANSACTION_RUNNER)
    private readonly transactions: TransactionRunner,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(GET_RESERVATION_DETAIL)
    private readonly detail: GetReservationDetail,
    @Inject(DAILY_LIST_CHANGE_RECORDER)
    private readonly dailyList: DailyListChangeRecorder,
    @Inject(ARI_CHANGE_RECORDER)
    private readonly availabilityChanges: AriChangeRecorder,
    @Inject(IDEMPOTENCY_KEY_REPOSITORY)
    private readonly idempotency: IdempotencyKeyRepository,
  ) {}

  /**
   * Punto 15 (T019): antes del paso 1, la `Idempotency-Key`. Con la misma clave y el mismo cuerpo, en las
   * últimas 24 horas, responde la misma reserva sin validar, verificar ni cotizar otra vez; con otro cuerpo,
   * `IDEMPOTENCY_KEY_REUSED`.
   */
  async execute(
    body: unknown,
    idempotencyKey: unknown,
  ): Promise<ReservationDetail> {
    const key = readIdempotencyKey(idempotencyKey);
    const requestHash = hashOf(body);
    const replay = await this.replayOf(
      await this.idempotency.find(key),
      requestHash,
    );
    if (replay !== null) {
      return replay;
    }
    try {
      return await this.create(body, key, requestHash);
    } catch (error) {
      if (!(error instanceof DuplicateIdempotencyKeyError)) {
        throw error;
      }
      // Otra solicitud con la misma clave confirmó primero: se responde como si hubiera llegado antes.
      const winner = await this.replayOf(
        await this.idempotency.find(key),
        requestHash,
      );
      if (winner === null) {
        throw error;
      }
      return winner;
    }
  }

  /** La reserva de una clave vigente con el mismo cuerpo; `null` si no hay clave vigente. */
  private async replayOf(
    stored: StoredIdempotencyKey | null,
    requestHash: string,
  ): Promise<ReservationDetail | null> {
    if (
      stored === null ||
      stored.createdAt.getTime() <= this.expiredBefore().getTime()
    ) {
      return null;
    }
    if (stored.requestHash !== requestHash) {
      throw new BusinessError(
        IDEMPOTENCY_KEY_REUSED.code,
        IDEMPOTENCY_KEY_REUSED.message,
      );
    }
    return this.detail.execute(stored.reservationRef);
  }

  /** Una clave creada en este instante o antes ya venció: vale menos de 24 horas (D16). */
  private expiredBefore(): Date {
    return new Date(this.clock.now().getTime() - IDEMPOTENCY_TTL_MS);
  }

  private async create(
    body: unknown,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ReservationDetail> {
    // Paso 1: regla 2, pasos 1 a 4, antes de consultar la disponibilidad o cotizar (FR-001a).
    const request = readCreationRequest(body, this.clock.today());
    const { startDate, endDate, categoryRoom } = request;

    // Paso 2: una consulta nueva, con mantenimientos; no se reutiliza la de la vista previa (regla 9).
    const availability = await this.availability.check({
      startDate,
      endDate,
      categoryRoom,
    });
    const assignedRooms = assignDirectRooms(request.rooms, availability);

    // Paso 3: se vuelve a cotizar y se compara con lo que vio el solicitante (decisión D1).
    const quoteRequests = assignedRooms.map(
      ({ position }): RoomQuoteRequest => ({
        key: String(position),
        categoryRoom,
        startDate,
        endDate,
      }),
    );
    const quotes = await this.rates.verifyQuotes(
      request.expectedRates.map(({ position, lodgingAmount, currency }) => ({
        key: String(position),
        lodgingAmount: Money.of(lodgingAmount, currency),
      })),
      quoteRequests,
      'NEW_RESERVATION',
    );

    // Paso 4: un titular nuevo, propio de esta reserva (regla 6), y las cotizaciones nuevas.
    const guest = Guest.restore({ id: randomUUID(), ...request.guest });
    const rooms = roomsWithRates(assignedRooms, quotes);

    // Paso 5: una transacción por intento, porque un error de unicidad la deja abortada (regla 7). Los
    // avisos van en la misma transacción: si se revierte, no queda ninguno (T010).
    const saved = await withNewReservationRef((reservationRef) =>
      this.transactions.run(async (tx) => {
        const reservation = await this.reservations.insert(
          Reservation.createDirect({
            reservationRef,
            startDate,
            endDate,
            guest,
            notes: request.notes,
            rooms,
          }),
          tx,
        );
        // Regla 8: `ADDED` solo si la llegada es hoy y la lista ya se envió; si no, nada.
        await this.dailyList.record(tx, null, reservation);
        // La disponibilidad que ocupa, para Channex: una sola categoría, de la entrada a la salida (FR-026).
        await this.availabilityChanges.record(tx, [
          { categoryRoom, dateFrom: startDate, dateTo: endDate },
        ]);
        // La clave va en la misma transacción: si la reserva se revierte, la clave tampoco queda (B).
        await this.idempotency.save(
          tx,
          {
            key: idempotencyKey,
            requestHash,
            reservationId: reservation.id,
            createdAt: this.clock.now(),
          },
          this.expiredBefore(),
        );
        return reservation;
      }),
    );

    // Paso 6: la misma forma que C3, con su `updatedAt`.
    return this.detail.execute(saved.reservationRef);
  }
}

/** Cuánto vive una `Idempotency-Key` (D16 del plan base). */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Un UUID en su forma estándar `8-4-4-4-12`. */
const UUID_FORMAT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La cabecera `Idempotency-Key`, obligatoria y UUID; queda en minúsculas, porque es el mismo UUID. */
function readIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !UUID_FORMAT.test(value.trim())) {
    throw new BusinessError(
      IDEMPOTENCY_KEY_REQUIRED.code,
      IDEMPOTENCY_KEY_REQUIRED.message,
    );
  }
  return value.trim().toLowerCase();
}

/** SHA-256 en hexadecimal del cuerpo en JSON con las claves ordenadas: el orden de las claves no cuenta. */
function hashOf(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Cada habitación asignada con la cotización nueva de su posición. */
function roomsWithRates(
  assignedRooms: readonly AssignedRoom[],
  quotes: readonly RoomQuote[],
): DirectRoomInput[] {
  const byKey = new Map(quotes.map((quote) => [quote.key, quote]));
  return assignedRooms.map(({ position, room, guestCount }) => {
    const quote = byKey.get(String(position));
    if (quote === undefined) {
      // `verifyQuotes` devuelve una por solicitud: si falta, es un error del programa.
      throw new Error(`Falta la cotización de la habitación ${position}.`);
    }
    return {
      room: {
        roomId: room.id,
        roomNumber: room.roomNumber,
        categoryRoom: room.categoryRoom,
        maxCapacity: room.maxCapacity,
      },
      guestCount,
      rate: { roomGrossAmount: quote.lodgingAmount, quoteId: quote.quoteId },
    };
  });
}
