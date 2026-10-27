import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import type { AxiosRequestConfig } from 'axios';
import type {
  MaintenanceCalendar,
  MaintenancePeriod,
} from '../../../application/integration/maintenance-calendar.js';
import type { Room } from '../../../application/integration/room.js';
import {
  Module1RejectedError,
  Module1RoomNotFoundError,
  Module1UnavailableError,
  type Module1Port,
} from '../../../application/ports/out/module1.port.js';
import { isValidCategoryRoom } from '../../../application/use-cases/consult-room-inventory/category-room.validator.js';
import { isValidRoomId } from '../../../application/use-cases/consult-room-inventory/room-id.validator.js';
import { isNonEmptyString, isObject, isRealDate, send } from '../http-call.js';

/**
 * Cliente HTTP del Módulo 1, con su tiempo máximo de espera (`MODULE1_TIMEOUT_MS`). Rutas propuestas en
 * `consult-room-inventory` (A1 a A3) y `consult-maintenance-calendar` (A1). Sin reintentos: ante un
 * fallo se informa y quien llama decide. Solo lectura: nunca modifica nada en el Módulo 1.
 */
@Injectable()
export class Module1HttpAdapter implements Module1Port {
  constructor(private readonly http: HttpService) {}

  async getRoom(roomId: string): Promise<Room> {
    const body = await this.get({
      url: `/api/rooms/${encodeURIComponent(roomId)}`,
    });
    return toRoom(body);
  }

  async listRoomsByCategory(categoryRoom: string): Promise<Room[]> {
    return toRooms(
      await this.get({ url: '/api/rooms', params: { categoryRoom } }),
    );
  }

  async listRooms(): Promise<Room[]> {
    return toRooms(await this.get({ url: '/api/rooms' }));
  }

  async getMaintenances(
    roomId: string,
    startDate: string,
    endDate: string,
  ): Promise<MaintenanceCalendar> {
    const body = await this.get({
      url: `/api/rooms/${encodeURIComponent(roomId)}/maintenances`,
      params: { startDate, endDate },
    });
    return toMaintenanceCalendar(body);
  }

  /** 200 con un JSON: el cuerpo. 404: la habitación no existe. 400: rechazo. Lo demás: no disponible. */
  private async get(config: AxiosRequestConfig): Promise<unknown> {
    const outcome = await send(this.http, { ...config, method: 'GET' });
    if (outcome.kind === 'no-response') {
      throw new Module1UnavailableError(outcome.reason);
    }
    if (outcome.status === 404) {
      throw new Module1RoomNotFoundError();
    }
    if (outcome.status === 400) {
      throw new Module1RejectedError();
    }
    if (outcome.status !== 200) {
      throw new Module1UnavailableError(`respondió ${outcome.status}`);
    }
    try {
      return JSON.parse(outcome.body) as unknown;
    } catch {
      throw new Module1UnavailableError('la respuesta no es JSON');
    }
  }
}

function unexpectedShape(): Module1UnavailableError {
  return new Module1UnavailableError('respuesta distinta del contrato');
}

/**
 * Solo los campos del contrato; cualquier otro se ignora. El `id` es un UUID y la `categoryRoom` tiene la
 * forma acordada (`consult-room-inventory`, A), con los mismos validadores de ese caso de uso.
 */
function toRoom(value: unknown): Room {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    !isValidRoomId(value.id) ||
    !isNonEmptyString(value.roomNumber) ||
    typeof value.categoryRoom !== 'string' ||
    !isValidCategoryRoom(value.categoryRoom) ||
    !Number.isInteger(value.maxCapacity) ||
    (value.maxCapacity as number) < 1
  ) {
    throw unexpectedShape();
  }
  return {
    id: value.id,
    roomNumber: value.roomNumber,
    categoryRoom: value.categoryRoom,
    maxCapacity: value.maxCapacity as number,
  };
}

function toRooms(value: unknown): Room[] {
  if (!Array.isArray(value)) {
    throw unexpectedShape();
  }
  return value.map(toRoom);
}

function toMaintenanceCalendar(value: unknown): MaintenanceCalendar {
  if (
    !isObject(value) ||
    !isNonEmptyString(value.roomId) ||
    typeof value.available !== 'boolean' ||
    !Array.isArray(value.conflicts)
  ) {
    throw unexpectedShape();
  }
  return {
    roomId: value.roomId,
    available: value.available,
    conflicts: value.conflicts.map(toMaintenancePeriod),
  };
}

function toMaintenancePeriod(value: unknown): MaintenancePeriod {
  if (
    !isObject(value) ||
    !isRealDate(value.maintenanceStart) ||
    !isRealDate(value.maintenanceEnd) ||
    value.maintenanceEnd < value.maintenanceStart
  ) {
    throw unexpectedShape();
  }
  return {
    maintenanceStart: value.maintenanceStart,
    maintenanceEnd: value.maintenanceEnd,
  };
}
