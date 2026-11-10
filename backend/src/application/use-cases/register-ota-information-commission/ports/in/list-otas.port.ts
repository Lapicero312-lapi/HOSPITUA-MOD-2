import type { OtaOverview } from '../../../../ports/out/ota.repository.js';

export type { OtaOverview };

/** Símbolo con el que Nest inyecta el servicio en el controlador. */
export const LIST_OTAS = Symbol('LIST_OTAS');

/** La consulta de agencias (plan, A3, `GET /api/otas`), de solo lectura. */
export interface ListOtas {
  /** Todas las agencias, también las `DISCONNECTED`, con su `activeReservations`, ordenadas por `name`. */
  execute(): Promise<OtaOverview[]>;
}
