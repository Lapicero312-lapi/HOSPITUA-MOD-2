import type { Room } from '../../src/application/integration/room.js';

/**
 * Las habitaciones del ejemplo A2 de `consult-room-inventory`, la 201 y la 202 de `DOBLE`, tal como las
 * devuelve el Módulo 1. Tienen un `id` fijo, el de la T012 de `check-room-availability`, para que todas las
 * pruebas que las usan hablen de las mismas habitaciones: una reserva guardada con `ROOM_201.id` se cruza
 * con la 201 que responde el Módulo 1 simulado.
 */
export const ROOM_201: Room = {
  id: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};

export const ROOM_202: Room = {
  id: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};
