import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../../../src/infrastructure/config/env.validation.js';
import {
  PG_TYPES,
  typeOrmOptions,
} from '../../../../src/infrastructure/config/typeorm.options.js';
import { OtaTable } from '../../../../src/infrastructure/out/persistence/tables/ota.table.js';
import {
  GuestTable,
  ReservationRoomTable,
  ReservationTable,
} from '../../../../src/infrastructure/out/persistence/tables/reservation.tables.js';
import { EsquemaBase1792461934191 } from '../../../../src/migrations/1792461934191-EsquemaBase.js';

describe('typeOrmOptions', () => {
  const options = typeOrmOptions(
    validateEnv({
      DB_HOST: 'db',
      DB_PORT: '6543',
      DB_NAME: 'hotel',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
    }),
  );

  it('usa PostgreSQL con los datos de conexión de la configuración', () => {
    expect(options).toMatchObject({
      type: 'postgres',
      host: 'db',
      port: 6543,
      database: 'hotel',
      username: 'u',
      password: 'p',
    });
  });

  it('nunca genera el esquema desde las clases: lo definen las migraciones (D11)', () => {
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
  });

  it('incluye la migración del esquema base', () => {
    expect(options.migrations).toContain(EsquemaBase1792461934191);
  });

  it('incluye las clases de tabla de T008', () => {
    expect(options.entities).toEqual(
      expect.arrayContaining([
        ReservationTable,
        ReservationRoomTable,
        GuestTable,
        OtaTable,
      ]),
    );
  });
});

describe('PG_TYPES', () => {
  const parse = (oid: number, text: string) =>
    PG_TYPES.getTypeParser(oid, 'text')(text);

  it('lee las fechas (date) como AAAA-MM-DD, sin pasar por la zona horaria', () => {
    expect(parse(pg.types.builtins.DATE, '2026-11-10')).toBe('2026-11-10');
  });

  it('lee las fechas con hora (timestamptz) como texto, con sus microsegundos', () => {
    expect(
      parse(pg.types.builtins.TIMESTAMPTZ, '2026-10-22 09:26:32.876138-05'),
    ).toBe('2026-10-22 09:26:32.876138-05');
  });

  it('los demás tipos se leen como siempre', () => {
    expect(parse(pg.types.builtins.INT4, '42')).toBe(42);
    expect(parse(pg.types.builtins.BOOL, 't')).toBe(true);
  });
});
