import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../src/application/ports/out/reservation.repository.js';
import { aDirectReservation } from '../../support/builders.js';
import { startSireApp } from '../support/sire.js';

/**
 * T016 de `export-sire-file`:
 * - NFR-001: "La generación del archivo debe tardar menos de 2 segundos para consultas de hasta 500
 *   movimientos".
 * - "un archivo grande (`SIRE_MAX_RECORDS`) sin agotar la memoria" (plan, punto 5: el tope de
 *   `SIRE_MAX_RECORDS` líneas por archivo existe para no agotar la memoria).
 *
 * Todo es real: la aplicación completa por HTTP y PostgreSQL, con la configuración por defecto
 * (`SIRE_MAX_RECORDS` = 50 000). Los movimientos se cargan con SQL por lotes, porque son datos de la prueba;
 * lo que se mide es el código de producción. Después de cargarlos se corre `ANALYZE`, como haría el
 * autovacuum de una base en uso.
 */

const LIMIT_MS = 2000;
const MAX_RECORDS = 50_000;

/** Marzo de 2031: 250 extranjeros con entrada y salida (500 movimientos) y 100 colombianos. */
const MARCH = ['2031-03-01', '2031-03-31'] as const;
const FOREIGN_IN_MARCH = 250;
const COLOMBIANS_IN_MARCH = 100;

/** El año 2032 (366 días, el periodo más largo): 25 000 extranjeros con entrada y salida. */
const YEAR = ['2032-01-01', '2032-12-31'] as const;
const FOREIGN_IN_YEAR = MAX_RECORDS / 2;

const RESERVATIONS = 20;

describe('Exportar archivo SIRE: tiempo de respuesta y archivo grande (T016, NFR-001)', () => {
  let sire: Awaited<ReturnType<typeof startSireApp>>;

  const newUser = () => `recepcion-${randomUUID()}`;

  /** Cuánto tarda `work`, en milisegundos. */
  async function timed<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; elapsed: number }> {
    const start = performance.now();
    const result = await work();
    return { result, elapsed: performance.now() - start };
  }

  /**
   * Carga `count` huéspedes con el prefijo `prefix` en su documento, repartidos en las reservas que ya
   * existen, con su entrada (`firstEntry` más hasta `spreadDays` días) y, si `withDeparture`, su salida
   * tres días después.
   */
  async function loadGuests(
    prefix: string,
    count: number,
    nationality: string,
    firstEntry: string,
    spreadDays: number,
    withDeparture = true,
  ): Promise<void> {
    await sire.dataSource.query(
      `INSERT INTO guest_data
         (id, reservation_id, document_type, document_number, first_name, last_name, birth_date,
          nationality, origin_place, destination_place)
       SELECT gen_random_uuid(), r.id, 'PAS', $1::text || g,
              CASE WHEN g % 7 = 0 THEN 'José' ELSE 'Nombre' END || ' ' || g,
              CASE WHEN g % 5 = 0 THEN 'Muñoz' ELSE 'Apellido' END,
              DATE '1980-01-01' + (g % 9000), $3::text, 'París, Francia', 'Bogotá, Colombia'
       FROM generate_series(1, $2::int) AS g
       JOIN (SELECT id, row_number() OVER (ORDER BY reservation_ref) - 1 AS n FROM reservation) r
         ON r.n = g % $4::int`,
      [prefix, count, nationality, RESERVATIONS],
    );
    const movements = [
      ['ENTRY', 0],
      ['DEPARTURE', 3],
    ] as const;
    for (const [movementType, offset] of withDeparture
      ? movements
      : movements.slice(0, 1)) {
      await sire.dataSource.query(
        `INSERT INTO migratory_movement (id, guest_data_id, movement_type, movement_date)
         SELECT gen_random_uuid(), gd.id, $2::text,
                $3::date + (substring(gd.document_number FROM length($1::text) + 1)::int % $4::int) + $5::int
         FROM guest_data gd WHERE gd.document_number LIKE $1::text || '%'`,
        [prefix, movementType, firstEntry, spreadDays, offset],
      );
    }
  }

  beforeAll(async () => {
    sire = await startSireApp();
    const reservations = sire.app.get<ReservationRepository>(
      RESERVATION_REPOSITORY,
    );
    for (let index = 0; index < RESERVATIONS; index++) {
      await reservations.insert(aDirectReservation());
    }
    // Marzo de 2031: las entradas del 5 al 24 y las salidas del 8 al 27.
    await loadGuests('M', FOREIGN_IN_MARCH, 'Francia', '2031-03-05', 20);
    await loadGuests('N', COLOMBIANS_IN_MARCH, 'Colombia', '2031-03-05', 20);
    // 2032: las entradas del 1 de enero al 25 de diciembre y las salidas tres días después.
    await loadGuests('Y', FOREIGN_IN_YEAR, 'Francia', '2032-01-01', 360);
    await sire.dataSource.query('ANALYZE guest_data');
    await sire.dataSource.query('ANALYZE migratory_movement');
  }, 120_000);

  afterAll(async () => {
    await sire?.app.close();
  });

  it(`NFR-001: un periodo con 500 movimientos de extranjeros se exporta en menos de ${LIMIT_MS / 1000} s`, async () => {
    // Una exportación antes de medir: la primera conexión a la base no es la condición normal.
    await sire.exportPeriod(newUser(), ...MARCH).expect(200);
    const user = newUser();

    const { result: res, elapsed } = await timed(() =>
      sire.exportPeriod(user, ...MARCH),
    );

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(LIMIT_MS);
    // Es el archivo completo: las 500 líneas de los extranjeros y ninguna de los 100 colombianos.
    expect(res.text.split('\r\n').filter((line) => line !== '')).toHaveLength(
      500,
    );
    expect(await sire.exportsOf(user)).toMatchObject([{ records_count: 500 }]);
  });

  it(`el archivo más grande permitido (SIRE_MAX_RECORDS = ${MAX_RECORDS} líneas, en el periodo más largo) se genera completo y queda registrado`, async () => {
    const user = newUser();

    const res = await sire.exportPeriod(user, ...YEAR).expect(200);

    const lines = res.text.split('\r\n');
    // Cada línea termina en CRLF, también la última: queda un elemento vacío al final.
    expect(lines).toHaveLength(MAX_RECORDS + 1);
    expect(lines.at(-1)).toBe('');
    expect(
      lines.slice(0, -1).every((line) => line.split('\t').length === 12),
    ).toBe(true);
    expect(await sire.exportsOf(user)).toMatchObject([
      { records_count: MAX_RECORDS },
    ]);
  }, 120_000);

  it('con un movimiento más que SIRE_MAX_RECORDS no se genera el archivo: 400 PERIOD_TOO_LARGE, sin registro', async () => {
    // Solo su entrada: con la salida serían dos de más, y un tope corrido en uno no se notaría.
    await loadGuests('Z', 1, 'Francia', '2032-06-01', 1, false);
    const [{ count }] = await sire.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM migratory_movement
       WHERE movement_date BETWEEN $1::date AND $2::date`,
      [...YEAR],
    );
    expect(count).toBe(MAX_RECORDS + 1);
    const user = newUser();

    const res = await sire.exportPeriod(user, ...YEAR).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'PERIOD_TOO_LARGE',
      message:
        'El periodo solicitado excede el límite permitido. Por favor exporte periodos más cortos.',
    });
    expect(await sire.exportsOf(user)).toEqual([]);
  }, 120_000);
});
