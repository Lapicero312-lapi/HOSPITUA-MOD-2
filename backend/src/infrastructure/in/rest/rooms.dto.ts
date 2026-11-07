import { ApiProperty } from '@nestjs/swagger';
import type { MaintenanceStatus } from '../../../application/use-cases/consult-room-inventory/ports/in/list-rooms-with-maintenance.port.js';
import {
  type ApiErrorBody,
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';

/** Qué significa cada `maintenance.status` (plan de `consult-room-inventory`, C1). */
const MAINTENANCE_STATUSES: Record<MaintenanceStatus, string> = {
  SCHEDULED: 'hay un mantenimiento próximo; trae el más cercano',
  NONE: 'no tiene',
  UNAVAILABLE:
    'no se pudo consultar el calendario de esa habitación; no se asume que no tiene',
};

/**
 * El mantenimiento próximo de una habitación en C1. Las clases de este archivo existen para que OpenAPI
 * documente la respuesta de `GET /api/rooms` (plan base, "Contratos REST"): un `type` no se puede leer.
 */
export class RoomMaintenanceDto {
  @ApiProperty({
    enum: Object.keys(MAINTENANCE_STATUSES),
    description: Object.entries(MAINTENANCE_STATUSES)
      .map(([status, meaning]) => `\`${status}\`: ${meaning}.`)
      .join(' '),
    example: 'SCHEDULED',
  })
  status: MaintenanceStatus;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description:
      'Inicio del mantenimiento más cercano; `null` si no tiene o si no se pudo consultar.',
    example: '2026-10-20',
  })
  maintenanceStart: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description:
      'Fin del mantenimiento más cercano; `null` si no tiene o si no se pudo consultar.',
    example: '2026-10-22',
  })
  maintenanceEnd: string | null;
}

/** Una habitación de C1: sus datos del inventario y su mantenimiento próximo, sin su estado (FR-006). */
export class RoomDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '201' })
  roomNumber: string;

  @ApiProperty({ pattern: '^[A-Z0-9_]{1,50}$', example: 'DOBLE' })
  categoryRoom: string;

  @ApiProperty({ type: 'integer', minimum: 1, example: 2 })
  maxCapacity: number;

  @ApiProperty({ type: RoomMaintenanceDto })
  maintenance: RoomMaintenanceDto;
}

/** La respuesta de C1, `GET /api/rooms`. */
export class RoomsDto {
  @ApiProperty({
    type: [RoomDto],
    description: 'Ordenadas por `categoryRoom` y luego por `roomNumber`.',
  })
  items: RoomDto[];

  @ApiProperty({ type: 'integer', example: 2 })
  total: number;
}

/** El ejemplo de C1 del plan: la 201 con un mantenimiento próximo y la 202 sin mantenimientos. */
export const ROOMS_EXAMPLE: RoomsDto = {
  items: [
    {
      id: '0b8a4c2e-5f1d-4e7a-9c3b-2d6f8e1a7b40',
      roomNumber: '201',
      categoryRoom: 'DOBLE',
      maxCapacity: 2,
      maintenance: {
        status: 'SCHEDULED',
        maintenanceStart: '2026-10-20',
        maintenanceEnd: '2026-10-22',
      },
    },
    {
      id: '7e2d9f14-3a6b-4c8d-b1e5-9f0a2c4d6e81',
      roomNumber: '202',
      categoryRoom: 'DOBLE',
      maxCapacity: 3,
      maintenance: {
        status: 'NONE',
        maintenanceStart: null,
        maintenanceEnd: null,
      },
    },
  ],
  total: 2,
};

const errorExample = (errorCode: string, message: string): ApiErrorBody => ({
  errorCode,
  message,
  timestamp: '2026-10-11T15:00:00.000Z',
  path: '/api/rooms',
});

/**
 * Los errores que puede responder `GET /api/rooms`, los dos con `400` (plan de `consult-room-inventory`,
 * C1 y "Reglas de validación y manejo de errores"). El de `INVENTORY_UNAVAILABLE` va con el literal de esa
 * tabla: la capa de entrada solo importa `application/` (plan base, tabla de capas), no `domain/`.
 */
export const ROOMS_ERROR_EXAMPLES = {
  INVENTORY_UNAVAILABLE: {
    summary: 'Falló el inventario del Módulo 1',
    value: errorExample(
      'INVENTORY_UNAVAILABLE',
      'No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo.',
    ),
  },
  [REQUEST_NOT_PROCESSED]: {
    summary: 'Una excepción inesperada',
    value: errorExample(REQUEST_NOT_PROCESSED, REQUEST_NOT_PROCESSED_MESSAGE),
  },
};
