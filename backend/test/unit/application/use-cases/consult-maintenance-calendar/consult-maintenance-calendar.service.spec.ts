import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceCalendar } from '../../../../../src/application/integration/maintenance-calendar.js';
import {
  Module1RejectedError,
  Module1RoomNotFoundError,
  Module1UnavailableError,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
import { ConsultMaintenanceCalendarService } from '../../../../../src/application/use-cases/consult-maintenance-calendar/consult-maintenance-calendar.service.js';
import {
  INVALID_ROOM_ID,
  INVALID_STAY_DATES,
  MAINTENANCE_CHECK_UNAVAILABLE,
} from '../../../../../src/domain/shared/error-codes.js';

/**
 * Datos de las pruebas del plan ("Pruebas por escenario", T007, T008 y T009), que dice de dónde sale cada
 * uno. Los `roomId` son UUID cualesquiera.
 */
const ROOM_ID = randomUUID();
const OTHER_ROOM_ID = randomUUID();
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

/** Un Módulo 1 que falla con `error`. */
function failingModule1(error: Error) {
  const getMaintenances = vi.fn(() => Promise.reject(error));
  return { module1: { getMaintenances } as unknown as Module1Port };
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

  it('con un cruce total: el cruce termina el día antes de la salida', async () => {
    const { module1 } = fakeModule1(
      calendarWith([
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-14' },
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
        maintenanceEnd: '2026-10-14',
        overlapStart: '2026-10-11',
        overlapEnd: '2026-10-13',
      },
    ]);
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

  it('el mismo roomId en mayúsculas no es una respuesta incoherente', async () => {
    const { module1 } = fakeModule1({
      roomId: ROOM_ID.toUpperCase(),
      available: true,
      conflicts: [],
    });

    expect(
      await new ConsultMaintenanceCalendarService(module1).check(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).toEqual({ roomId: ROOM_ID, available: true, conflicts: [] });
  });

  describe('una respuesta incoherente del Módulo 1 se bloquea con MAINTENANCE_CHECK_UNAVAILABLE y deja el detalle en el log', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each<[string, MaintenanceCalendar, string]>([
      [
        'available true con mantenimientos',
        {
          roomId: ROOM_ID,
          available: true,
          conflicts: [
            { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
          ],
        },
        'available es true pero conflicts no está vacío (1)',
      ],
      [
        'available false sin mantenimientos',
        { roomId: ROOM_ID, available: false, conflicts: [] },
        'available es false pero conflicts está vacío',
      ],
      [
        'un mantenimiento que no se cruza con la estadía',
        calendarWith([
          { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-10' },
        ]),
        'el mantenimiento del 2026-10-10 al 2026-10-10 no se cruza con la estadía del 2026-10-11 al 2026-10-14',
      ],
      [
        'la respuesta de otra habitación',
        { roomId: OTHER_ROOM_ID, available: true, conflicts: [] },
        `responde por otra habitación (${OTHER_ROOM_ID})`,
      ],
    ])('%s', async (_, calendar, detail) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { module1 } = fakeModule1(calendar);

      await expect(
        new ConsultMaintenanceCalendarService(module1).check(
          ROOM_ID,
          START_DATE,
          END_DATE,
        ),
      ).rejects.toMatchObject({
        errorCode: MAINTENANCE_CHECK_UNAVAILABLE.code,
        message: MAINTENANCE_CHECK_UNAVAILABLE.message,
      });
      expect(warn).toHaveBeenCalledWith(
        `Respuesta incoherente del Módulo 1 para la habitación ${ROOM_ID}: ${detail}.`,
      );
    });
  });

  describe('los errores del Módulo 1 salen con el código del plan', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each<[string, Error]>([
      ['un 404 (la habitación no existe)', new Module1RoomNotFoundError()],
      ['un 400 (rechaza la consulta)', new Module1RejectedError()],
    ])('%s es INVALID_ROOM_ID, sin nada en el log', async (_, error) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { module1 } = failingModule1(error);

      await expect(
        new ConsultMaintenanceCalendarService(module1).check(
          ROOM_ID,
          START_DATE,
          END_DATE,
        ),
      ).rejects.toMatchObject({
        errorCode: INVALID_ROOM_ID.code,
        message: INVALID_ROOM_ID.message,
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      'tiempo de espera agotado',
      'sin respuesta (ECONNREFUSED)',
      'respondió 503',
      'la respuesta no es JSON',
      'respuesta distinta del contrato',
    ])(
      'el Módulo 1 no disponible (%s) es MAINTENANCE_CHECK_UNAVAILABLE y deja el detalle en el log',
      async (detail) => {
        const warn = vi
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        const { module1 } = failingModule1(new Module1UnavailableError(detail));

        await expect(
          new ConsultMaintenanceCalendarService(module1).check(
            ROOM_ID,
            START_DATE,
            END_DATE,
          ),
        ).rejects.toMatchObject({
          errorCode: MAINTENANCE_CHECK_UNAVAILABLE.code,
          message: MAINTENANCE_CHECK_UNAVAILABLE.message,
        });
        expect(warn).toHaveBeenCalledWith(
          `Consulta de mantenimientos de la habitación ${ROOM_ID}: El Módulo 1 no está disponible: ${detail}.`,
        );
      },
    );

    it('un error inesperado sale sin convertir', async () => {
      const unexpected = new Error('falla inesperada');
      const { module1 } = failingModule1(unexpected);

      await expect(
        new ConsultMaintenanceCalendarService(module1).check(
          ROOM_ID,
          START_DATE,
          END_DATE,
        ),
      ).rejects.toBe(unexpected);
    });
  });
});

describe('ConsultMaintenanceCalendarService.nextMaintenance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sin cruces devuelve null', async () => {
    const { module1 } = fakeModule1(calendarWith([]));

    expect(
      await new ConsultMaintenanceCalendarService(module1).nextMaintenance(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).toBeNull();
  });

  // El contrato con el Módulo 1 no fija un orden: el más cercano puede venir primero o último.
  it.each([
    [
      'el más cercano primero',
      [
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
        { maintenanceStart: '2026-10-13', maintenanceEnd: '2026-10-13' },
      ],
    ],
    [
      'el más cercano último',
      [
        { maintenanceStart: '2026-10-13', maintenanceEnd: '2026-10-13' },
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
      ],
    ],
  ])('con varios cruces devuelve el más cercano (%s)', async (_, conflicts) => {
    const { module1 } = fakeModule1(calendarWith(conflicts));

    expect(
      await new ConsultMaintenanceCalendarService(module1).nextMaintenance(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).toEqual({
      maintenanceStart: '2026-10-10',
      maintenanceEnd: '2026-10-12',
      overlapStart: '2026-10-11',
      overlapEnd: '2026-10-12',
    });
  });

  it('con varios cruces devuelve el de menor inicio aunque termine después', async () => {
    // El cruce total empieza antes que el del 2026-10-13, pero termina después.
    const { module1 } = fakeModule1(
      calendarWith([
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-14' },
        { maintenanceStart: '2026-10-13', maintenanceEnd: '2026-10-13' },
      ]),
    );

    expect(
      await new ConsultMaintenanceCalendarService(module1).nextMaintenance(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).toEqual({
      maintenanceStart: '2026-10-10',
      maintenanceEnd: '2026-10-14',
      overlapStart: '2026-10-11',
      overlapEnd: '2026-10-13',
    });
  });

  it('un fallo del Módulo 1 se propaga como MAINTENANCE_CHECK_UNAVAILABLE', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { module1 } = failingModule1(
      new Module1UnavailableError('tiempo de espera agotado'),
    );

    await expect(
      new ConsultMaintenanceCalendarService(module1).nextMaintenance(
        ROOM_ID,
        START_DATE,
        END_DATE,
      ),
    ).rejects.toMatchObject({
      errorCode: MAINTENANCE_CHECK_UNAVAILABLE.code,
      message: MAINTENANCE_CHECK_UNAVAILABLE.message,
    });
  });
});
