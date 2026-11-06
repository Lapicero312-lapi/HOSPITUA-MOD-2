import type { SireExport } from '../../../domain/migration/sire-export.js';
import type { Transaction } from './transaction.js';

/** Símbolo con el que Nest inyecta el repositorio (plan base, regla 4). */
export const SIRE_EXPORT_REPOSITORY = Symbol('SIRE_EXPORT_REPOSITORY');

/**
 * Las descargas del archivo SIRE (`export-sire-file`, T004: "solo inserción y lectura"). No hay métodos
 * para cambiarlas ni borrarlas: son el registro auditable de cada descarga (punto 11). Sin `tx`, cada
 * método usa su propia transacción.
 */
export interface SireExportRepository {
  /** Guarda una descarga nueva (FR-007) y la devuelve tal como quedó guardada. */
  insert(sireExport: SireExport, tx?: Transaction): Promise<SireExport>;

  /** La descarga con ese `exportId`, o `null` si no existe. */
  findById(id: string, tx?: Transaction): Promise<SireExport | null>;
}
