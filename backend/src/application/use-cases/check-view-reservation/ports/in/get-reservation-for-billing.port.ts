/** Símbolo con el que Nest inyecta el servicio (plan base, regla 4). */
export const GET_RESERVATION_FOR_BILLING = Symbol(
  'GET_RESERVATION_FOR_BILLING',
);

/** Lo que el Módulo 3 necesita para liquidar una reserva (plan de `check-view-reservation`, C4). */
export type ReservationForBilling = {
  reservationRef: string;
  channel: 'DIRECT' | 'OTA';
  /** El `quoteId` de cada habitación que lo tiene, en el orden de las habitaciones; vacía en `OTA`. */
  quoteIds: string[];
  /** Solo en `OTA`: la agencia, su código y el porcentaje congelado en la reserva (de 0 a 100). */
  ota: {
    otaId: string;
    confirmationCode: string;
    commissionPercentage: string;
  } | null;
};

/**
 * La consulta del Módulo 3 por referencia (plan, "Consulta del Módulo 3", T032; FR-022). Solo lee y no
 * entrega otros datos financieros ni del huésped.
 */
export interface GetReservationForBilling {
  /**
   * @throws BusinessError `INVALID_RESERVATION_CODE` si `reservationRef` no es `RSV-` y 8 hexadecimales en
   * mayúscula (sin consultar la base, como C3), o `RESERVATION_NOT_FOUND` si no existe.
   */
  execute(reservationRef: string): Promise<ReservationForBilling>;
}
