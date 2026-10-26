import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Exclusión mutua de las tareas programadas entre instancias del Módulo 2 (plan base, C10): bloqueo
 * asesor de PostgreSQL con `pg_try_advisory_lock`. Si otra instancia tiene el bloqueo, se salta esa
 * ejecución. Las tareas que no deben correr a la vez usan el mismo nombre de bloqueo.
 */
@Injectable()
export class AdvisoryLock {
  constructor(private readonly dataSource: DataSource) {}

  /** Ejecuta `task` solo si consigue el bloqueo `name`. Devuelve `false` si otra instancia lo tenía. */
  async runExclusive(
    name: string,
    task: () => Promise<void>,
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
        await task();
      } finally {
        await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
      }
      return true;
    } finally {
      await runner.release();
    }
  }
}
