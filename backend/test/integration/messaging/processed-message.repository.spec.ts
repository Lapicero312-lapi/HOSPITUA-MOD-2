import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessedMessage } from '../../../src/application/ports/out/processed-message.repository.js';
import { TypeOrmProcessedMessageRepository } from '../../../src/infrastructure/out/messaging/processed-message.repository.js';
import { TypeOrmTransactionRunner } from '../../../src/infrastructure/out/persistence/typeorm-transaction.js';
import { openTestDataSource, truncateAllTables } from '../support/database.js';

const CHECK_IN_QUEUE = 'm2.habitacion.checkin.queue';
const CHECK_OUT_QUEUE = 'm2.habitacion.checkout.queue';

const aMessage = (
  overrides: Partial<ProcessedMessage> = {},
): ProcessedMessage => ({
  messageId: '7c1e9a52-3b0d-4f7e-9a61-2d8c5b4e1f03',
  queue: CHECK_IN_QUEUE,
  sequenceNumber: 42,
  ...overrides,
});

describe('TypeOrmProcessedMessageRepository contra PostgreSQL real', () => {
  let dataSource: DataSource;
  let messages: TypeOrmProcessedMessageRepository;
  let transactions: TypeOrmTransactionRunner;

  const rows = (): Promise<
    {
      message_id: string;
      queue: string;
      sequence_number: string;
      processed_at: string;
    }[]
  > => dataSource.query('SELECT * FROM processed_message');

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    messages = new TypeOrmProcessedMessageRepository(dataSource);
    transactions = new TypeOrmTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('un messageId que nunca llegó no está procesado', async () => {
    await expect(
      transactions.run((tx) => messages.isProcessed(aMessage().messageId, tx)),
    ).resolves.toBe(false);
  });

  it('registra el mensaje con su cola, su sequenceNumber y la hora de la base', async () => {
    await transactions.run((tx) => messages.record(aMessage(), tx));

    const [row] = await rows();
    expect(row).toMatchObject({
      message_id: '7c1e9a52-3b0d-4f7e-9a61-2d8c5b4e1f03',
      queue: CHECK_IN_QUEUE,
      sequence_number: '42',
    });
    expect(row.processed_at).toBeTruthy();
    await expect(
      transactions.run((tx) => messages.isProcessed(aMessage().messageId, tx)),
    ).resolves.toBe(true);
  });

  it('dentro de la misma transacción, el mensaje recién registrado ya cuenta como procesado', async () => {
    const seen = await transactions.run(async (tx) => {
      await messages.record(aMessage(), tx);
      return messages.isProcessed(aMessage().messageId, tx);
    });

    expect(seen).toBe(true);
  });

  it('si la transacción del cambio se revierte, el mensaje no queda registrado', async () => {
    await expect(
      transactions.run(async (tx) => {
        await messages.record(aMessage(), tx);
        throw new Error('falló el cambio');
      }),
    ).rejects.toThrow('falló el cambio');

    expect(await rows()).toHaveLength(0);
  });

  it('un messageId repetido, aun de otra cola, lo rechaza la clave primaria y revierte su transacción', async () => {
    await transactions.run((tx) => messages.record(aMessage(), tx));

    await expect(
      transactions.run((tx) =>
        messages.record(
          aMessage({ queue: CHECK_OUT_QUEUE, sequenceNumber: 43 }),
          tx,
        ),
      ),
    ).rejects.toThrow(/processed_message_pkey|duplicate key/);

    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0].queue).toBe(CHECK_IN_QUEUE);
  });

  it('dos entregas simultáneas del mismo mensaje: solo una lo registra y la otra falla para reintentarse', async () => {
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstRecorded!: () => void;
    const recorded = new Promise<void>((resolve) => {
      firstRecorded = resolve;
    });

    const first = transactions.run(async (tx) => {
      await messages.record(aMessage(), tx);
      firstRecorded();
      await firstHolds;
    });
    await recorded;
    // La segunda espera a que la primera confirme, y entonces la clave primaria la rechaza.
    const second = transactions.run((tx) => messages.record(aMessage(), tx));
    releaseFirst();

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toThrow(
      /processed_message_pkey|duplicate key/,
    );
    expect(await rows()).toHaveLength(1);
    await expect(
      transactions.run((tx) => messages.isProcessed(aMessage().messageId, tx)),
    ).resolves.toBe(true);
  });

  it('acepta un sequenceNumber más grande que un integer', async () => {
    await transactions.run((tx) =>
      messages.record(aMessage({ sequenceNumber: 9_007_199_254_740_991 }), tx),
    );

    expect((await rows())[0].sequence_number).toBe('9007199254740991');
  });
});
