import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { MaintenanceCalendar } from '../../../../../src/application/integration/maintenance-calendar.js';
import type { Module1Port } from '../../../../../src/application/ports/out/module1.port.js';
import { ConsultMaintenanceCalendarService } from '../../../../../src/application/use-cases/consult-maintenance-calendar/consult-maintenance-calendar.service.js';
import {
  INVALID_ROOM_ID,
  INVALID_STAY_DATES,
} from '../../../../../src/domain/shared/error-codes.js';

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T007), que dice de dónde sale cada uno. El
 * `roomId` es un UUID cualquiera.
 */
const ROOM_ID = randomUUID();
const START_DATE = '2026-10-11';
const END_DATE = '2026-10-14';

/** Un Módulo 1 que responde `calendar` y registra cada consulta. */
function fakeModule1(calendar: MaintenanceCalendar) {
  const getMaintenances = vi.fn(() => Promise.resolve(calendar));
  return {
    getMaintenances,
    module1: { getMaintenances } as unknown as Module1Port,
  };
}

/** La respuesta del Módulo 1 con los mantenimientos que se cruzan (`[]` si no hay). */
function calendarWith(
  conflicts: MaintenanceCalendar['conflicts'],
): MaintenanceCalendar {
  return { roomId: ROOM_ID, available: conflicts.length === 0, conflicts };
}

describe('ConsultMaintenanceCalendarService.check', () => {
  it('le pide al Módulo 1 los mantenimientos de la habitación en las fechas de la estadía', async () => {
    const { getMaintenances, module1 } = fakeModule1(calendarWith([]));

    await new ConsultMaintenanceCalendarService(module1).check(
      ROOM_ID,
      START_DATE,
      END_DATE,
    );

    expect(getMaintenances).toHaveBeenCalledWith(ROOM_ID, START_DATE, END_DATE);
  });

  it('sin mantenimientos: la habitación está disponible y no hay cruces', async () => {
    const { module1 } = fakeModule1(calendarWith([]));

    expect(
      await new ConsultMaintenanceCalendarService(module1).check(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).toEqual({ roomId: ROOM_ID, available: true, conflicts: [] });
  });

  it('con un cruce: devuelve el mantenimiento con el periodo del cruce', async () => {
    const { module1 } = fakeModule1(
      calendarWith([
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
      ]),
    );

    expect(
      await new ConsultMaintenanceCalendarService(module1).check(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).toEqual({
      roomId: ROOM_ID,
      available: false,
      conflicts: [
        {
          maintenanceStart: '2026-10-10',
          maintenanceEnd: '2026-10-12',
          overlapStart: '2026-10-11',
          overlapEnd: '2026-10-12',
        },
      ],
    });
  });

  it('con varios cruces: devuelve cada mantenimiento con su periodo', async () => {
    const { module1 } = fakeModule1(
      calendarWith([
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
        { maintenanceStart: '2026-10-13', maintenanceEnd: '2026-10-13' },
      ]),
    );

    const check = await new ConsultMaintenanceCalendarService(module1).check(
      ROOM_ID,
      START_DATE,
      END_DATE,
    );

    expect(check.conflicts).toEqual([
      {
        maintenanceStart: '2026-10-10',
        maintenanceEnd: '2026-10-12',
        overlapStart: '2026-10-11',
        overlapEnd: '2026-10-12',
      },
      {
        maintenanceStart: '2026-10-13',
        maintenanceEnd: '2026-10-13',
        overlapStart: '2026-10-13',
        overlapEnd: '2026-10-13',
      },
    ]);
  });

  it('un roomId inválido es INVALID_ROOM_ID y no llama al Módulo 1', async () => {
    const { getMaintenances, module1 } = fakeModule1(calendarWith([]));

    await expect(
      new ConsultMaintenanceCalendarService(module1).check(
        '201',
        START_DATE,
        END_DATE,
      ),
    ).rejects.toMatchObject({
      errorCode: INVALID_ROOM_ID.code,
      message: INVALID_ROOM_ID.message,
    });
    expect(getMaintenances).not.toHaveBeenCalled();
  });

  it('una salida anterior a la llegada es INVALID_STAY_DATES y no llama al Módulo 1', async () => {
    const { getMaintenances, module1 } = fakeModule1(calendarWith([]));

    await expect(
      new ConsultMaintenanceCalendarService(module1).check(
        ROOM_ID,
        END_DATE,
        START_DATE,
      ),
    ).rejects.toMatchObject({
      errorCode: INVALID_STAY_DATES.code,
      message: INVALID_STAY_DATES.message,
    });
    expect(getMaintenances).not.toHaveBeenCalled();
  });

  it('un mantenimiento que no se cruza con la estadía es una respuesta incoherente: no se asume nada', async () => {
    const { module1 } = fakeModule1(
      calendarWith([
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-10' },
      ]),
    );

    await expect(
      new ConsultMaintenanceCalendarService(module1).check(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).rejects.toThrow(
      'Respuesta incoherente del Módulo 1: el mantenimiento del 2026-10-10 al 2026-10-10 no se cruza con la estadía.',
    );
  });
});
