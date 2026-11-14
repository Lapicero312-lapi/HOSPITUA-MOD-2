import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { ExclusiveRunner } from '../../../application/ports/out/exclusive-runner.js';

/**
 * `ExclusiveRunner` con un bloqueo asesor de PostgreSQL (`pg_try_advisory_lock`), como el `AdvisoryLock`
 * de las tareas (plan base, C10): sirve entre instancias. Si otra ejecución tiene el bloqueo, no espera.
 */
@Injectable()
export class AdvisoryExclusiveRunner implements ExclusiveRunner {
  private readonly logger = new Logger(AdvisoryExclusiveRunner.name);

  constructor(private readonly dataSource: DataSource) {}

  async runExclusive(
    name: string,
    work: () => Promise<void>,
  ): Promise<boolean> {
    // El bloqueo pertenece a la sesión: se toma y se suelta en la misma conexión.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows: { locked: boolean }[] = await runner.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [name],
      );
      if (!rows[0]?.locked) {
        return false;
      }
      try {
        await work();
      } catch (error) {
        // Si además falla soltar el bloqueo, ese error se registra y no tapa al del trabajo.
        await this.unlock(runner, name).catch((unlockError: unknown) => {
          this.logger.error(
            `No se pudo soltar el bloqueo "${name}" después de un error`,
            unlockError instanceof Error
              ? unlockError.stack
              : String(unlockError),
          );
        });
        throw error;
      }
      await this.unlock(runner, name);
      return true;
    } finally {
      await runner.release();
    }
  }

  private async unlock(runner: QueryRunner, name: string): Promise<void> {
    await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
  }
}
