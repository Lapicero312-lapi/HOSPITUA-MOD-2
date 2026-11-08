import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../../../../src/application/ports/out/clock.js';
import type { SireConfig } from '../../../../../src/application/ports/out/sire-config.js';
import type { SireExportRepository } from '../../../../../src/application/ports/out/sire-export.repository.js';
import { ExportSireFileService } from '../../../../../src/application/use-cases/export-sire-file/export-sire-file.service.js';
import type {
  SelectForeignMovements,
  SireMovement,
} from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';

const NOW = new Date('2026-11-02T15:30:00Z');

/** La configuración por defecto del plan, con un hotel y una ciudad. */
const CONFIG: SireConfig = {
  format: {
    hotelCode: '123456',
    cityCode: '11001',
    fieldSeparator: '\t',
    dateFormat: 'dd/MM/yyyy',
    encoding: 'utf-8',
  },
  lineBreak: '\r\n',
  maxPeriodDays: 366,
  maxRecords: 50000,
};

/** John Smith, del ejemplo del contrato A. */
function john(changes: Partial<SireMovement> = {}): SireMovement {
  return {
    movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
    reservationRef: 'RSV-3F9A1C7B',
    movementType: 'ENTRY',
    movementDate: '2026-10-09',
    guest: {
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: 'X99',
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
    },
    ...changes,
  };
}

/** Pierre Dubois, francés, sin destino. */
function pierre(changes: Partial<SireMovement> = {}): SireMovement {
  return john({
    movementId: 'c0000000-0000-4000-8000-000000000002',
    guest: {
      firstName: 'Pierre',
      lastName: 'Dubois',
      documentType: 'PAS',
      documentNumber: 'FR123456',
      birthDate: '1985-02-03',
      nationality: 'Francia',
      originPlace: 'París, Francia',
      destinationPlace: null,
    },
    ...changes,
  });
}

/** Las líneas del contrato A para John. */
const JOHN_ENTRY =
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990';
const JOHN_DEPARTURE =
  '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tS\t12/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990';

function serviceWith({
  period = [] as SireMovement[],
  single = null as SireMovement | null,
  config = CONFIG,
} = {}) {
  const byPeriod = vi
    .fn<SelectForeignMovements['byPeriod']>()
    .mockResolvedValue(period);
  const byMovementId = vi
    .fn<SelectForeignMovements['byMovementId']>()
    .mockResolvedValue(single);
  const insert = vi
    .fn<SireExportRepository['insert']>()
    .mockImplementation((sireExport) => Promise.resolve(sireExport));
  const clock: Clock = {
    today: () => '2026-11-02',
    now: () => NOW,
  };
  const service = new ExportSireFileService(
    { byPeriod, byMovementId },
    { insert, findById: vi.fn() },
    config,
    clock,
  );
  /** Lo que se registró de cada descarga. */
  const registered = () =>
    insert.mock.calls.map(([sireExport]) => sireExport.snapshot());
  return { service, byPeriod, byMovementId, insert, registered };
}

const OCTOBER = {
  exportKind: 'PERIOD',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
} as const;

describe('ExportSireFileService (plan de export-sire-file, contrato A, reglas y D1)', () => {
  describe('PERIOD', () => {
    it('escenario 1: dos extranjeros que entran y salen dan 4 líneas con su fin de línea, y una SireExport con recordsCount 4', async () => {
      const { service, byPeriod, registered } = serviceWith({
        period: [
          john(),
          pierre(),
          john({
            movementId: 'c0000000-0000-4000-8000-000000000003',
            movementType: 'DEPARTURE',
            movementDate: '2026-10-12',
          }),
          pierre({
            movementId: 'c0000000-0000-4000-8000-000000000004',
            movementType: 'DEPARTURE',
            movementDate: '2026-10-13',
          }),
        ],
      });

      const file = await service.execute(OCTOBER, 'Ana Recepción');

      expect(byPeriod).toHaveBeenCalledExactlyOnceWith(
        '2026-10-01',
        '2026-10-31',
      );
      const lines = file.content.split('\r\n');
      expect(lines).toHaveLength(5);
      expect(lines[4]).toBe('');
      expect(lines[0]).toBe(JOHN_ENTRY);
      expect(lines[2]).toBe(JOHN_DEPARTURE);
      // Pierre sin destino: el campo 11 queda vacío.
      expect(lines[1].split('\t')[10]).toBe('');
      expect(file.recordsCount).toBe(4);
      expect(registered()).toEqual([
        {
          id: file.exportId,
          exportDate: NOW,
          exportKind: 'PERIOD',
          recordsCount: 4,
          dateRangeStart: '2026-10-01',
          dateRangeEnd: '2026-10-31',
          processedBy: 'Ana Recepción',
        },
      ]);
      expect(file.fileName).toBe(`SIRE_${file.exportId}.txt`);
    });

    it('regla 6: conserva el orden que entrega SelectForeignMovements, sin volver a ordenar', async () => {
      const { service } = serviceWith({
        period: [
          john({ movementType: 'DEPARTURE', movementDate: '2026-10-12' }),
          john(),
        ],
      });

      const { content } = await service.execute(OCTOBER, 'Ana');

      expect(content).toBe(`${JOHN_DEPARTURE}\r\n${JOHN_ENTRY}\r\n`);
    });

    it('escenario 4: el mismo periodo dos veces da el mismo archivo y dos SireExport distintas', async () => {
      const { service, registered } = serviceWith({ period: [john()] });

      const first = await service.execute(OCTOBER, 'Ana');
      const second = await service.execute(OCTOBER, 'Ana');

      expect(second.content).toBe(first.content);
      expect(second.exportId).not.toBe(first.exportId);
      expect(registered()).toHaveLength(2);
    });

    it('escenario 5: sin extranjeros en el periodo, NO_MIGRATORY_MOVEMENTS, sin archivo ni SireExport', async () => {
      const { service, insert } = serviceWith({ period: [] });

      await expect(service.execute(OCTOBER, 'Ana')).rejects.toMatchObject({
        errorCode: 'NO_MIGRATORY_MOVEMENTS',
        message: 'No hay movimientos migratorios que reportar en ese periodo.',
      });
      expect(insert).not.toHaveBeenCalled();
    });

    it('con más de SIRE_MAX_RECORDS líneas, PERIOD_TOO_LARGE y sin registro; con justo el máximo, sale', async () => {
      const config = { ...CONFIG, maxRecords: 2 };
      const tooMany = serviceWith({ period: [john(), john(), john()], config });
      const justRight = serviceWith({ period: [john(), john()], config });

      await expect(
        tooMany.service.execute(OCTOBER, 'Ana'),
      ).rejects.toMatchObject({
        errorCode: 'PERIOD_TOO_LARGE',
        message:
          'El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos.',
      });
      expect(tooMany.insert).not.toHaveBeenCalled();
      await expect(
        justRight.service.execute(OCTOBER, 'Ana'),
      ).resolves.toMatchObject({ recordsCount: 2 });
    });

    it('regla 7: si un huésped no se puede escribir, INVALID_GUEST_CHARACTERS y no queda SireExport, aunque los anteriores sí', async () => {
      const broken = pierre();
      broken.guest = { ...broken.guest, lastName: 'Du\tbois' };
      const { service, insert } = serviceWith({ period: [john(), broken] });

      await expect(service.execute(OCTOBER, 'Ana')).rejects.toMatchObject({
        errorCode: 'INVALID_GUEST_CHARACTERS',
      });
      expect(insert).not.toHaveBeenCalled();
    });

    it('con LF y otro separador, usa los de la configuración', async () => {
      const { service } = serviceWith({
        period: [john()],
        config: {
          ...CONFIG,
          format: { ...CONFIG.format, fieldSeparator: '|' },
          lineBreak: '\n',
        },
      });

      const { content } = await service.execute(OCTOBER, 'Ana');

      expect(content).toBe(`${JOHN_ENTRY.replaceAll('\t', '|')}\n`);
    });
  });

  describe('SINGLE_MOVEMENT (T009)', () => {
    const single = {
      exportKind: 'SINGLE_MOVEMENT',
      movementId: '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b',
    } as const;

    it('escenario 7: un .TXT de una línea y una SireExport con recordsCount 1 y sin fechas', async () => {
      const { service, byMovementId, byPeriod, registered } = serviceWith({
        single: john(),
      });

      const file = await service.execute(single, 'Ana Recepción');

      expect(byMovementId).toHaveBeenCalledExactlyOnceWith(single.movementId);
      expect(byPeriod).not.toHaveBeenCalled();
      expect(file.content).toBe(`${JOHN_ENTRY}\r\n`);
      expect(registered()).toEqual([
        {
          id: file.exportId,
          exportDate: NOW,
          exportKind: 'SINGLE_MOVEMENT',
          recordsCount: 1,
          dateRangeStart: null,
          dateRangeEnd: null,
          processedBy: 'Ana Recepción',
        },
      ]);
    });

    it('un movimiento que no está, o es de un colombiano, es MOVEMENT_NOT_FOUND y no se registra', async () => {
      const { service, insert } = serviceWith({ single: null });

      await expect(service.execute(single, 'Ana')).rejects.toMatchObject({
        errorCode: 'MOVEMENT_NOT_FOUND',
        message: 'El movimiento no existe.',
      });
      expect(insert).not.toHaveBeenCalled();
    });

    it('un huésped que no se puede escribir es INVALID_GUEST_CHARACTERS y no se registra', async () => {
      const broken = john();
      broken.guest = { ...broken.guest, firstName: 'Jo\nhn' };
      const { service, insert } = serviceWith({ single: broken });

      await expect(service.execute(single, 'Ana')).rejects.toMatchObject({
        errorCode: 'INVALID_GUEST_CHARACTERS',
      });
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
