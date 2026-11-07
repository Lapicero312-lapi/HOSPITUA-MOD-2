import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  DailySequence,
  DailySequenceRepository,
} from '../../../../application/ports/out/daily-sequence.repository.js';
import type { Transaction } from '../../../../application/ports/out/transaction.js';
import { managerFor } from '../typeorm-transaction.js';

/** `DailySequenceRepository` sobre la tabla `daily_sequence` (la crea la migración base). */
@Injectable()
export class TypeOrmDailySequenceRepository implements DailySequenceRepository {
  constructor(private readonly dataSource: DataSource) {}

  async lockDay(
    operationalDate: string,
    tx: Transaction,
  ): Promise<DailySequence | null> {
    const rows: { last_sequence: number; list_generated: boolean }[] =
      await managerFor(this.dataSource, tx).query(
        `SELECT last_sequence, list_generated FROM daily_sequence
         WHERE operational_date = $1 FOR UPDATE`,
        [operationalDate],
      );
    if (rows.length === 0) {
      return null;
    }
    return {
      lastSequence: rows[0].last_sequence,
      listGenerated: rows[0].list_generated,
    };
  }

  async setLastSequence(
    operationalDate: string,
    lastSequence: number,
    tx: Transaction,
  ): Promise<void> {
    await managerFor(this.dataSource, tx).query(
      'UPDATE daily_sequence SET last_sequence = $2 WHERE operational_date = $1',
      [operationalDate, lastSequence],
    );
  }

  async lockOrCreateDay(
    operationalDate: string,
    tx: Transaction,
  ): Promise<DailySequence> {
    // Si otra transacción la está creando, este INSERT espera a que termine y luego no hace nada.
    await managerFor(this.dataSource, tx).query(
      `INSERT INTO daily_sequence (operational_date) VALUES ($1)
       ON CONFLICT (operational_date) DO NOTHING`,
      [operationalDate],
    );
    const day = await this.lockDay(operationalDate, tx);
    if (day === null) {
      throw new Error(
        `La fila de daily_sequence del ${operationalDate} no existe después de crearla.`,
      );
    }
    return day;
  }

  async markListGenerated(
    operationalDate: string,
    tx: Transaction,
  ): Promise<void> {
    await managerFor(this.dataSource, tx).query(
      `UPDATE daily_sequence SET last_sequence = 1, list_generated = true
       WHERE operational_date = $1`,
      [operationalDate],
    );
  }
}
