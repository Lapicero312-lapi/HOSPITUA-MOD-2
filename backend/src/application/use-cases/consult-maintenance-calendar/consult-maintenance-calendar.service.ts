import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_ROOM_ID,
  INVALID_STAY_DATES,
  MAINTENANCE_CHECK_UNAVAILABLE,
} from '../../../domain/shared/error-codes.js';
import type {
  MaintenanceCalendar,
  MaintenanceCheck,
  MaintenanceConflict,
} from '../../integration/maintenance-calendar.js';
import {
  MODULE1_PORT,
  type Module1Port,
} from '../../ports/out/module1.port.js';
import {
  isValidRoomId,
  isValidStayDates,
} from './maintenance-request.validator.js';
import { overlap } from './overlap.js';
import type { ConsultMaintenanceCalendar } from './ports/in/consult-maintenance-calendar.port.js';

/**
 * Valida la consulta, le pide al Módulo 1 los mantenimientos de la habitación en la estadía y arma el
 * resultado con el periodo de cada cruce (plan, D1). Una respuesta incoherente del Módulo 1 se bloquea:
 * nunca se asume que la habitación está libre (plan, "Reglas de validación y manejo de errores").
 */
@Injectable()
export class ConsultMaintenanceCalendarService implements ConsultMaintenanceCalendar {
  private readonly logger = new Logger(ConsultMaintenanceCalendarService.name);

  constructor(
    @Inject(MODULE1_PORT)
    private readonly module1: Module1Port,
  ) {}

  async check(
    roomId: string,
    startDate: string,
    endDate: string,
  ): Promise<MaintenanceCheck> {
    if (!isValidRoomId(roomId)) {
      throw new BusinessError(INVALID_ROOM_ID.code, INVALID_ROOM_ID.message);
    }
    if (!isValidStayDates(startDate, endDate)) {
      throw new BusinessError(
        INVALID_STAY_DATES.code,
        INVALID_STAY_DATES.message,
      );
    }

    const calendar = await this.module1.getMaintenances(
      roomId,
      startDate,
      endDate,
    );
    const incoherence = incoherenceOf(calendar, roomId);
    if (incoherence !== null) {
      throw this.incoherentResponse(roomId, incoherence);
    }

    const conflicts: MaintenanceConflict[] = [];
    for (const maintenance of calendar.conflicts) {
      const period = overlap(maintenance, { startDate, endDate });
      if (period === null) {
        throw this.incoherentResponse(
          roomId,
          `el mantenimiento del ${maintenance.maintenanceStart} al ${maintenance.maintenanceEnd} no se cruza con la estadía del ${startDate} al ${endDate}`,
        );
      }
      conflicts.push({
        maintenanceStart: maintenance.maintenanceStart,
        maintenanceEnd: maintenance.maintenanceEnd,
        overlapStart: period.overlapStart,
        overlapEnd: period.overlapEnd,
      });
    }
    return { roomId, available: calendar.available, conflicts };
  }

  /** Deja en el log por qué la respuesta del Módulo 1 es incoherente y la bloquea. */
  private incoherentResponse(roomId: string, detail: string): BusinessError {
    this.logger.warn(
      `Respuesta incoherente del Módulo 1 para la habitación ${roomId}: ${detail}.`,
    );
    return new BusinessError(
      MAINTENANCE_CHECK_UNAVAILABLE.code,
      MAINTENANCE_CHECK_UNAVAILABLE.message,
    );
  }
}

/**
 * Por qué la respuesta del Módulo 1 no cuadra, o `null` si cuadra: es de otra habitación, o `available`
 * contradice a `conflicts`. Un UUID es el mismo en mayúsculas o en minúsculas.
 */
function incoherenceOf(
  calendar: MaintenanceCalendar,
  roomId: string,
): string | null {
  if (calendar.roomId.toLowerCase() !== roomId.toLowerCase()) {
    return `responde por otra habitación (${calendar.roomId})`;
  }
  if (calendar.available && calendar.conflicts.length > 0) {
    return `available es true pero conflicts no está vacío (${calendar.conflicts.length})`;
  }
  if (!calendar.available && calendar.conflicts.length === 0) {
    return 'available es false pero conflicts está vacío';
  }
  return null;
}
