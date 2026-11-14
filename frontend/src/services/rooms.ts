import { apiRequest } from './api-client.ts';

/**
 * El mantenimiento próximo de una habitación (plan de `consult-room-inventory`, C1). Las fechas son
 * `AAAA-MM-DD`:
 * - `SCHEDULED`: hay un mantenimiento próximo; trae el más cercano;
 * - `NONE`: no tiene;
 * - `UNAVAILABLE`: no se pudo consultar el calendario de esa habitación; no se asume que no tiene.
 */
export type RoomMaintenance =
  | { status: 'SCHEDULED'; maintenanceStart: string; maintenanceEnd: string }
  | {
      status: 'NONE' | 'UNAVAILABLE';
      maintenanceStart: null;
      maintenanceEnd: null;
    };

/** Una habitación vendible del Módulo 1, sin su estado (FR-006). */
export type Room = {
  id: string;
  roomNumber: string;
  categoryRoom: string;
  maxCapacity: number;
  maintenance: RoomMaintenance;
};

/** La respuesta de `GET /api/rooms` (C1). */
export type RoomList = {
  items: Room[];
  total: number;
};

/**
 * `GET /api/rooms` (C1): todas las habitaciones vendibles con su mantenimiento próximo, ya ordenadas
 * por `categoryRoom` y luego por `roomNumber`, sin paginar.
 * @throws ApiError con el error que respondió el backend (por ejemplo `INVENTORY_UNAVAILABLE`).
 */
export function listRooms(signal?: AbortSignal): Promise<RoomList> {
  return apiRequest<RoomList>('/rooms', { signal });
}
