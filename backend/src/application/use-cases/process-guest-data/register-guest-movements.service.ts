import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { GuestData } from '../../../domain/migration/guest-data.js';
import { isForeign } from '../../../domain/migration/is-foreign.js';
import { MigratoryMovement } from '../../../domain/migration/migratory-movement.js';
import type { DocumentType } from '../../../domain/shared/enums.js';
import {
  GUEST_DATA_REPOSITORY,
  type GuestDataRepository,
} from '../../ports/out/guest-data.repository.js';
import {
  MIGRATORY_MOVEMENT_REPOSITORY,
  type MigratoryMovementRepository,
} from '../../ports/out/migratory-movement.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../ports/out/reservation.repository.js';
import type { Transaction } from '../../ports/out/transaction.js';
import type {
  GuestPayload,
  RegisterGuestMovements,
  RegisterGuestMovementsCommand,
  RegistrationSummary,
} from './ports/in/register-guest-movements.port.js';

/** Los datos que la base exige (regla 3 de registro): sin uno de ellos, el huésped se omite. */
const REQUIRED_FIELDS = [
  'documentType',
  'documentNumber',
  'firstName',
  'lastName',
  'birthDate',
  'nationality',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** Un huésped con todos los datos que la base exige. */
type CompleteGuest = GuestPayload & Required<Pick<GuestPayload, RequiredField>>;

/** Un huésped de la lista con su lugar en ella (desde 1), para el log: no lleva datos personales. */
type Listed<T> = { position: number; guest: T };

/**
 * `RegisterGuestMovements` (plan, B1, "Reglas de registro" y D1), dentro de la transacción de quien llama:
 * quita los repetidos, omite al huésped al que le falta un dato que la base exige, guarda los datos de los
 * demás y su movimiento con los dos `INSERT … ON CONFLICT DO NOTHING`, y devuelve el `RegistrationSummary`.
 * No revisa el contenido de los datos ni los cambia (FR-004). El paso 1, validar la estructura, lo hace
 * el consumidor con `readGuestNotification` antes de llamarlo.
 */
@Injectable()
export class RegisterGuestMovementsService implements RegisterGuestMovements {
  private readonly logger = new Logger(RegisterGuestMovementsService.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(GUEST_DATA_REPOSITORY)
    private readonly guestData: GuestDataRepository,
    @Inject(MIGRATORY_MOVEMENT_REPOSITORY)
    private readonly movements: MigratoryMovementRepository,
  ) {}

  async register(
    tx: Transaction,
    command: RegisterGuestMovementsCommand,
  ): Promise<RegistrationSummary> {
    // `GuestData` guarda la reserva por su `reservationRef` (plan base); el comando trae su id.
    const reservation = await this.reservations.findById(
      command.reservationId,
      tx,
    );
    if (reservation === null) {
      throw new Error(`La reserva ${command.reservationId} no existe.`);
    }
    const where = `reserva ${reservation.reservationRef}, habitación ${command.roomId}`;

    // Regla 2: un mismo `documentNumber` se procesa una vez, el primero.
    const received = withoutRepeated(command.guests);

    // Regla 3: se omite solo al huésped al que le falta un dato; los demás siguen (FR-007, SC-004).
    const complete: Listed<GuestData>[] = [];
    for (const { position, guest } of received) {
      if (!isComplete(guest)) {
        this.logger.warn(
          `Se omitió al huésped ${position} de la notificación (${where}) porque le falta: ${missingFields(guest).join(', ')}.`,
        );
        continue;
      }
      complete.push({
        position,
        guest: toGuestData(guest, reservation.reservationRef),
      });
    }

    // Regla 4: el huésped que ya existe en la reserva vuelve tal como estaba, con su id (FR-017).
    const stored = await this.guestData.insertMissing(
      complete.map(({ guest }) => guest),
      tx,
    );

    // Regla 5: un `ENTRY` y un `DEPARTURE` por huésped y reserva, aunque se repita (FR-005).
    const movements = stored.map((guest) =>
      MigratoryMovement.restore({
        id: randomUUID(),
        guestDataId: guest.id,
        movementType: command.movementType,
        movementDate: command.movementDate,
      }),
    );
    const registered = await this.movements.insertMissing(movements, tx);

    // Una salida sin entrada: el `GuestData` lo creó esta misma salida, porque la entrada lo habría creado.
    if (command.movementType === 'DEPARTURE') {
      stored.forEach((guest, index) => {
        const { position, guest: sent } = complete[index];
        if (guest.id === sent.id) {
          this.logger.warn(
            `Se registró la salida del huésped ${position} de la notificación (${where}) sin una entrada registrada.`,
          );
        }
      });
    }

    // Regla 6.
    return {
      received: received.length,
      registered,
      alreadyRegistered: movements.length - registered,
      foreign: received.filter(
        ({ guest }) =>
          guest.nationality !== undefined && isForeign(guest.nationality),
      ).length,
      skipped: received.length - complete.length,
    };
  }
}

/**
 * Los huéspedes de la lista sin repetir `documentNumber`: queda el primero. A los que no traen documento
 * no se los puede comparar, así que cada uno cuenta por separado (y la regla 3 los omite).
 */
function withoutRepeated(guests: GuestPayload[]): Listed<GuestPayload>[] {
  const seen = new Set<string>();
  const unique: Listed<GuestPayload>[] = [];
  guests.forEach((guest, index) => {
    const { documentNumber } = guest;
    if (documentNumber !== undefined) {
      if (seen.has(documentNumber)) {
        return;
      }
      seen.add(documentNumber);
    }
    unique.push({ position: index + 1, guest });
  });
  return unique;
}

function missingFields(guest: GuestPayload): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => guest[field] === undefined);
}

function isComplete(guest: GuestPayload): guest is CompleteGuest {
  return missingFields(guest).length === 0;
}

/**
 * Los datos tal como llegaron, sin revisarlos ni cambiarlos (FR-004). El tipo de documento lo controla
 * la base (CHECK de la migración base); el lugar de procedencia y el de destino que no vienen quedan
 * `null`.
 */
function toGuestData(guest: CompleteGuest, reservationRef: string): GuestData {
  return GuestData.restore({
    id: randomUUID(),
    reservationRef,
    firstName: guest.firstName,
    lastName: guest.lastName,
    documentType: guest.documentType as DocumentType,
    documentNumber: guest.documentNumber,
    birthDate: guest.birthDate,
    nationality: guest.nationality,
    originPlace: guest.originPlace ?? null,
    destinationPlace: guest.destinationPlace ?? null,
  });
}
