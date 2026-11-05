import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La agencia sin el id del hotel de Booking y con el porcentaje de comisión opcional (plan base, tabla
 * `ota`). El id del hotel se indica en Channex al conectar el canal Booking.com, y el porcentaje lo calcula
 * el sistema con la primera reserva de la agencia (`register-ota-information-commission`): hasta entonces
 * queda vacío.
 */
export class OtaSinHotelYPorcentajeOpcional1793368536386 implements MigrationInterface {
  name = 'OtaSinHotelYPorcentajeOpcional1793368536386';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE ota DROP COLUMN hotel_account_id`);
    // El CHECK de 0 a 100 se conserva: no aplica a un valor vacío.
    await queryRunner.query(
      `ALTER TABLE ota ALTER COLUMN commission_percentage DROP NOT NULL`,
    );
  }

  /**
   * Vuelve al esquema base. Falla si alguna agencia todavía no tiene porcentaje, y las agencias quedan sin
   * id del hotel: ese dato ya no existe.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ota ALTER COLUMN commission_percentage SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ota ADD COLUMN hotel_account_id varchar(100) CONSTRAINT uq_ota_hotel_account_id UNIQUE`,
    );
  }
}
