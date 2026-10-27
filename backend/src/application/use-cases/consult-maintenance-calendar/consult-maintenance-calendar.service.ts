import { Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_ROOM_ID,
  INVALID_STAY_DATES,
} from '../../../domain/shared/error-codes.js';
import type {
  MaintenanceCheck,
  MaintenanceConflict,
  MaintenancePeriod,
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
 * resultado con el periodo de cada cruce (plan, D1).
 */
@Injectable()
export class ConsultMaintenanceCalendarService implements ConsultMaintenanceCalendar {
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
    return {
      roomId,
      available: calendar.available,
      conflicts: calendar.conflicts.map((maintenance) =>
        toConflict(maintenance, { startDate, endDate }),
      ),
    };
  }
}

/** El mantenimiento con el periodo en que se cruza con la estadía. */
function toConflict(
  maintenance: MaintenancePeriod,
  stay: { startDate: string; endDate: string },
): MaintenanceConflict {
  const period = overlap(maintenance, stay);
  if (period === null) {
    throw new Error(
      `Respuesta incoherente del Módulo 1: el mantenimiento del ${maintenance.maintenanceStart} al ${maintenance.maintenanceEnd} no se cruza con la estadía.`,
    );
  }
  return {
    maintenanceStart: maintenance.maintenanceStart,
    maintenanceEnd: maintenance.maintenanceEnd,
    overlapStart: period.overlapStart,
    overlapEnd: period.overlapEnd,
  };
}
