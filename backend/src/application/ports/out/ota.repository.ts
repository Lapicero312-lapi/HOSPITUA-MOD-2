import type { Ota } from '../../../domain/ota/ota.js';
import type { ConnectionStatus } from '../../../domain/shared/enums.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const OTA_REPOSITORY = Symbol('OTA_REPOSITORY');

/**
 * Una agencia en la consulta de agencias (plan de `register-ota-information-commission`, A3): sus datos y
 * cuántas reservas suyas están en `PENDING`, `ACTIVE` o `IN_PROGRESS`.
 */
export type OtaOverview = {
  id: string;
  name: string;
  /** Texto decimal (`15.00` es el 15 %); `null` mientras la agencia no tenga su primera reserva. */
  commissionPercentage: string | null;
  connectionStatus: ConnectionStatus;
  linkedAt: Date;
  lastSyncAt: Date;
  activeReservations: number;
};

/** Guarda y lee las agencias. Una `Ota` nunca se borra. */
export interface OtaRepository {
  findById(id: string, tx?: Transaction): Promise<Ota | null>;

  findByName(name: string, tx?: Transaction): Promise<Ota | null>;

  /** @throws DuplicateOtaError si ya hay una agencia con ese nombre. */
  insert(ota: Ota, tx?: Transaction): Promise<Ota>;

  /** Guarda los datos nuevos de una agencia que ya existe. */
  update(ota: Ota, tx?: Transaction): Promise<Ota>;

  /**
   * Guarda solo el `connectionStatus` y, si viene, el `lastSyncAt` (plan, B3): no reescribe el resto de la
   * agencia, así no pisa el porcentaje que otra transacción guarde a la vez.
   */
  updateConnection(
    id: string,
    connectionStatus: ConnectionStatus,
    lastSyncAt?: Date,
  ): Promise<void>;

  /** A3: todas las agencias con su `activeReservations`, ordenadas por `name`. */
  listOverviews(): Promise<OtaOverview[]>;

  /** A3: una agencia con su `activeReservations`, o `null` si no existe. Recibe un UUID. */
  findOverviewById(id: string): Promise<OtaOverview | null>;
}

/** Ya existe una agencia con ese nombre (único en `ota`). */
export class DuplicateOtaError extends Error {
  constructor(readonly field: 'name') {
    super(`Ya existe una agencia con ese ${field}.`);
  }
}
