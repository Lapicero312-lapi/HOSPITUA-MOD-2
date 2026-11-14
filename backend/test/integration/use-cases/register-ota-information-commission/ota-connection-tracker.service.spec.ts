import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OtaConnectionTrackerService } from '../../../../src/application/use-cases/register-ota-information-commission/ota-connection-tracker.service.js';
import type { OtaConnectionTracker } from '../../../../src/application/use-cases/register-ota-information-commission/ports/in/ota-connection-tracker.port.js';
import type { Ota } from '../../../../src/domain/ota/ota.js';
import { TypeOrmOtaRepository } from '../../../../src/infrastructure/out/persistence/repositories/ota.repository.js';
import { anOta } from '../../../support/builders.js';
import {
  openTestDataSource,
  truncateAllTables,
} from '../../support/database.js';

/** Una lectura del feed que terminó bien. La agencia de `anOta` es la del ejemplo del plan (A3). */
const AT = new Date('2026-11-05T13:00:00.000Z');

describe('OtaConnectionTracker contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let otas: TypeOrmOtaRepository;
  // Con el tipo del puerto, como lo usarán `generate-ota-reservation` y `configure-ota`.
  let tracker: OtaConnectionTracker;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    otas = new TypeOrmOtaRepository(dataSource);
    tracker = new OtaConnectionTrackerService(otas);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function read(id: string): Promise<Ota> {
    const ota = await otas.findById(id);
    expect(ota).not.toBeNull();
    return ota!;
  }

  /** El nombre, el `linkedAt` y el porcentaje no cambian nunca (plan, B3; spec, FR-008a). */
  function expectUntouched(after: Ota, before: Ota): void {
    expect(after.name).toBe(before.name);
    expect(after.linkedAt).toEqual(before.linkedAt);
    expect(after.commissionPercentage).toBe(before.commissionPercentage);
  }

  async function updatedAt(id: string): Promise<string> {
    const [row]: { updated_at: unknown }[] = await dataSource.query(
      'SELECT updated_at FROM ota WHERE id = $1',
      [id],
    );
    return String(row.updated_at);
  }

  it('US3 escenario 5: markSynced estando CONNECTED solo actualiza lastSyncAt', async () => {
    const before = await otas.insert(anOta());

    await tracker.markSynced(before.id, AT);

    const after = await read(before.id);
    expect(after.connectionStatus).toBe('CONNECTED');
    expect(after.lastSyncAt).toEqual(AT);
    expectUntouched(after, before);
  });

  it('US3 escenario 4: markSynced estando DISCONNECTED vuelve a CONNECTED sin cambiar linkedAt', async () => {
    const before = await otas.insert(
      anOta({ connectionStatus: 'DISCONNECTED' }),
    );

    await tracker.markSynced(before.id, AT);

    const after = await read(before.id);
    expect(after.connectionStatus).toBe('CONNECTED');
    expect(after.lastSyncAt).toEqual(AT);
    expectUntouched(after, before);
  });

  it('US3 escenario 3: markDisconnected estando CONNECTED pasa a DISCONNECTED sin cambiar lastSyncAt', async () => {
    const before = await otas.insert(anOta());

    await tracker.markDisconnected(before.id, AT);

    const after = await read(before.id);
    expect(after.connectionStatus).toBe('DISCONNECTED');
    expect(after.lastSyncAt).toEqual(before.lastSyncAt);
    expectUntouched(after, before);
  });

  it('markDisconnected ya en DISCONNECTED no guarda nada', async () => {
    const before = await otas.insert(
      anOta({ connectionStatus: 'DISCONNECTED' }),
    );
    const savedAt = await updatedAt(before.id);

    await tracker.markDisconnected(before.id, AT);

    expect(await updatedAt(before.id)).toBe(savedAt);
    const after = await read(before.id);
    expect(after.connectionStatus).toBe('DISCONNECTED');
    expect(after.lastSyncAt).toEqual(before.lastSyncAt);
    expectUntouched(after, before);
  });

  it.each([
    ['markSynced', (id: string) => tracker.markSynced(id, AT)],
    ['markDisconnected', (id: string) => tracker.markDisconnected(id, AT)],
  ])('%s con una agencia que no existe es OTA_NOT_FOUND', async (_, mark) => {
    await expect(mark('994d1375-dbbd-4072-8724-b2ab32ce781b')).rejects.toThrow(
      expect.objectContaining({
        errorCode: 'OTA_NOT_FOUND',
        message: 'La agencia no existe.',
      }),
    );
  });

  // La agencia se lee sin porcentaje y, antes de que el tracker guarde, otra transacción guarda el de su
  // primera reserva (`setCommissionPercentage`). Si el tracker reescribiera la agencia completa, lo borraría.
  it.each([
    [
      'markSynced',
      (t: OtaConnectionTracker, id: string) => t.markSynced(id, AT),
    ],
    [
      'markDisconnected',
      (t: OtaConnectionTracker, id: string) => t.markDisconnected(id, AT),
    ],
  ])('%s no pisa el porcentaje que se guarda a la vez', async (_, mark) => {
    const ota = await otas.insert(anOta({ commissionPercentage: null }));
    const percentageSavedMeanwhile = new (class extends TypeOrmOtaRepository {
      override async findById(id: string): Promise<Ota | null> {
        const read = await super.findById(id);
        await dataSource.query(
          `UPDATE ota SET commission_percentage = '15.00' WHERE id = $1`,
          [id],
        );
        return read;
      }
    })(dataSource);

    await mark(
      new OtaConnectionTrackerService(percentageSavedMeanwhile),
      ota.id,
    );

    expect((await read(ota.id)).commissionPercentage).toBe('15');
  });
});
