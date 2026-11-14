import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  integrationEnv,
  openTestDataSource,
  truncateAllTables,
} from '../support/database.js';

/** El día operativo en curso, en hora de Colombia (`AAAA-MM-DD`), como `Clock.today()`. */
function todayInBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
  }).format(new Date());
}

/**
 * La aplicación completa (`AppModule`) con PostgreSQL real: comprueba que `DailyListJob` está conectado
 * al arranque (en `JobsModule`) y que la recuperación genera la lista del día una sola vez aunque la
 * aplicación arranque dos veces (plan de `check-view-reservation`, "Tareas programadas"; T024).
 */
describe('Al arrancar la aplicación sin la lista del día generada', () => {
  let dataSource: DataSource;

  /** Arranca la aplicación y la cierra: al cerrar, espera a que termine la recuperación en curso. */
  async function startAndStop(): Promise<void> {
    const { AppModule } = await import('../../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication({
      logger: false,
    });
    await app.init();
    await app.close();
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    await truncateAllTables(dataSource);
    // Antes de importar AppModule: AppConfigModule lee el entorno al importarse.
    Object.assign(process.env, { NODE_ENV: 'test', ...integrationEnv() });
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('genera la lista del día en curso (vacía, secuencia 1), la publica al confirmarla (T029) y no la repite al volver a arrancar', async () => {
    const today = todayInBogota();

    await startAndStop();
    await startAndStop();

    const messages: {
      operational_date: string;
      sequence_number: number;
      message_kind: string;
      publish_status: string;
      total_reservations: number;
    }[] = await dataSource.query(
      `SELECT to_char(operational_date, 'YYYY-MM-DD') AS operational_date, sequence_number,
              message_kind, publish_status, (payload->>'totalReservations')::int AS total_reservations
         FROM daily_list_message`,
    );
    expect(messages).toEqual([
      {
        operational_date: today,
        sequence_number: 1,
        message_kind: 'LIST',
        // La publicación inmediata (T029): el apagado la espera, así que ya salió.
        publish_status: 'PUBLISHED',
        total_reservations: 0,
      },
    ]);
    const days: { list_generated: boolean; last_sequence: number }[] =
      await dataSource.query(
        'SELECT list_generated, last_sequence FROM daily_sequence WHERE operational_date = $1',
        [today],
      );
    expect(days).toEqual([{ list_generated: true, last_sequence: 1 }]);
  });
});
