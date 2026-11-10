/** Símbolo con el que Nest inyecta el caso de uso (plan base, regla 4). */
export const GET_DAY_SUMMARY = Symbol('GET_DAY_SUMMARY');

/** El resumen del día operativo (plan de `check-view-reservation`, C2; FR-005a). */
export type DaySummary = {
  /** `AAAA-MM-DD`. */
  operationalDate: string;
  /** Reservas `ACTIVE` o `PENDING` con `startDate` igual al día operativo. */
  expectedArrivals: number;
  /** Reservas `IN_PROGRESS` con `endDate` igual al día operativo. */
  expectedDepartures: number;
};

/** El resumen que la Recepcionista ve encima del listado (C2, T012). */
export interface GetDaySummary {
  execute(): Promise<DaySummary>;
}
