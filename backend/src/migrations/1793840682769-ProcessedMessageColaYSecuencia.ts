import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El índice que necesita el control de secuencia de los mensajes del Módulo 1 (plan de
 * `update-reservation`, modelo de datos): buscar el mayor `sequence_number` ya procesado de una cola para
 * detectar un salto (FR-023).
 */
export class ProcessedMessageColaYSecuencia1793840682769 implements MigrationInterface {
  name = 'ProcessedMessageColaYSecuencia1793840682769';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX ix_processed_message_queue_sequence ON processed_message (queue, sequence_number)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX ix_processed_message_queue_sequence`);
  }
}
