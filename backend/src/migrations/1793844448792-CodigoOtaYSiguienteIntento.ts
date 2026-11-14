import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lo que `check-view-reservation` agrega al esquema (plan, "Índices y extensiones"): buscar por el código
 * de la OTA sin distinguir mayúsculas, y guardar cuándo toca el siguiente intento de publicar un aviso al
 * Módulo 1 (vacío hasta el primer fallo). El índice no es único: dos agencias pueden repetir el código.
 */
export class CodigoOtaYSiguienteIntento1793844448792 implements MigrationInterface {
  name = 'CodigoOtaYSiguienteIntento1793844448792';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX ix_reservation_external_confirmation_code_lower ON reservation (lower(external_confirmation_code))`,
    );
    await queryRunner.query(
      `ALTER TABLE daily_list_message ADD COLUMN next_attempt_at timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE daily_list_message DROP COLUMN next_attempt_at`,
    );
    await queryRunner.query(
      `DROP INDEX ix_reservation_external_confirmation_code_lower`,
    );
  }
}
