/**
 * Hay menos habitaciones disponibles que las pedidas (plan de `check-room-availability`, B2). Lleva las
 * habitaciones que no lo están y su motivo; cada flujo de reserva lo traduce a su código y su mensaje.
 */
export class FewerAvailableRoomsThanRequestedError extends Error {
  constructor(
    readonly unavailableRooms: readonly {
      room: { id: string; roomNumber: string };
      reason: 'RESERVED' | 'MAINTENANCE';
    }[],
  ) {
    super('Hay menos habitaciones disponibles que las pedidas.');
  }
}

/**
 * Exige `quantity` habitaciones disponibles en el resultado de la verificación (plan de
 * `check-room-availability`, B2). Si las hay, no devuelve nada; si hay menos, lanza
 * `FewerAvailableRoomsThanRequestedError`. Una habitación no disponible sin motivo rompe el contrato
 * (`reason` es `null` solo si está disponible): es un error del programa y se lanza `Error` (plan base).
 *
 * Recibe solo los campos que usa del `AvailabilityResult`: el dominio no conoce los tipos de
 * `application/`.
 */
export function requireAvailable(
  result: {
    rooms: readonly {
      room: { id: string; roomNumber: string };
      available: boolean;
      reason: 'RESERVED' | 'MAINTENANCE' | null;
    }[];
  },
  quantity: number,
): void {
  const availableCount = result.rooms.filter(
    ({ available }) => available,
  ).length;
  if (availableCount < quantity) {
    throw new FewerAvailableRoomsThanRequestedError(
      result.rooms
        .filter(({ available }) => !available)
        .map(({ room, reason }) => {
          if (reason === null) {
            throw new Error(
              'Habitación inconsistente: una habitación no disponible debe traer su motivo.',
            );
          }
          return { room, reason };
        }),
    );
  }
}
