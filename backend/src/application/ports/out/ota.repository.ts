import type { Ota } from '../../../domain/ota/ota.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const OTA_REPOSITORY = Symbol('OTA_REPOSITORY');

/** Guarda y lee las agencias. Una `Ota` nunca se borra. */
export interface OtaRepository {
  findById(id: string, tx?: Transaction): Promise<Ota | null>;

  findByName(name: string, tx?: Transaction): Promise<Ota | null>;

  /** @throws DuplicateOtaError si ya hay una agencia con ese nombre o esa cuenta del hotel. */
  insert(ota: Ota, tx?: Transaction): Promise<Ota>;

  /** Guarda los datos nuevos de una agencia que ya existe. */
  update(ota: Ota, tx?: Transaction): Promise<Ota>;
}

/** Ya existe una agencia con ese nombre o esa cuenta del hotel (únicos en `ota`). */
export class DuplicateOtaError extends Error {
  constructor(readonly field: 'name' | 'hotelAccountId') {
    super(`Ya existe una agencia con ese ${field}.`);
  }
}
