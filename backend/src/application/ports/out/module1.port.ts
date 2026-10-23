import type { MaintenanceCalendar } from '../../integration/maintenance-calendar.js';
import type { Room } from '../../integration/room.js';

/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const MODULE1_PORT = Symbol('MODULE1_PORT');

/**
 * Lo que el Módulo 2 consulta al Módulo 1 (plan base, regla 3): si cambia su API, solo cambia el
 * adaptador. Solo lectura. Cada caso de uso traduce los errores a sus códigos (`INVALID_ROOM_ID`,
 * `INVENTORY_UNAVAILABLE`, `MAINTENANCE_CHECK_UNAVAILABLE`, ...).
 */
export interface Module1Port {
  /** @throws Module1RoomNotFoundError, Module1RejectedError o Module1UnavailableError. */
  getRoom(roomId: string): Promise<Room>;

  /** Todas las habitaciones vendibles de la categoría; `[]` si no tiene. */
  listRoomsByCategory(categoryRoom: string): Promise<Room[]>;

  /** Todas las habitaciones vendibles, de todas las categorías. */
  listRooms(): Promise<Room[]>;

  /**
   * Los mantenimientos de la habitación que se cruzan con el rango.
   * @throws Module1RoomNotFoundError, Module1RejectedError o Module1UnavailableError.
   */
  getMaintenances(
    roomId: string,
    startDate: string,
    endDate: string,
  ): Promise<MaintenanceCalendar>;
}

/** El Módulo 1 respondió 404: la habitación no existe. */
export class Module1RoomNotFoundError extends Error {
  constructor() {
    super('El Módulo 1 no conoce la habitación (404).');
  }
}

/** El Módulo 1 respondió 400: rechazó los datos de la consulta. */
export class Module1RejectedError extends Error {
  constructor() {
    super('El Módulo 1 rechazó la consulta (400).');
  }
}

/**
 * El Módulo 1 no respondió a tiempo, no se pudo conectar, respondió 5xx u otro estado inesperado, o
 * envió una respuesta con una forma que no es la del contrato. Nunca se asume la respuesta.
 */
export class Module1UnavailableError extends Error {
  constructor(detail: string) {
    super(`El Módulo 1 no está disponible: ${detail}.`);
  }
}
