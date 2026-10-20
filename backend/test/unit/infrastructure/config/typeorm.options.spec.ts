import { validateEnv } from '../../../../src/infrastructure/config/env.validation.js';
import { opcionesTypeOrm } from '../../../../src/infrastructure/config/typeorm.options.js';
import { EsquemaBase1792461934191 } from '../../../../src/migrations/1792461934191-EsquemaBase.js';

describe('opcionesTypeOrm', () => {
  const opciones = opcionesTypeOrm(
    validateEnv({
      DB_HOST: 'db',
      DB_PORT: '6543',
      DB_NAME: 'hotel',
      DB_USER: 'u',
      DB_PASSWORD: 'p',
    }),
  );

  it('usa PostgreSQL con los datos de conexión de la configuración', () => {
    expect(opciones).toMatchObject({
      type: 'postgres',
      host: 'db',
      port: 6543,
      database: 'hotel',
      username: 'u',
      password: 'p',
    });
  });

  it('nunca genera el esquema desde las clases: lo definen las migraciones (D11)', () => {
    expect(opciones.synchronize).toBe(false);
    expect(opciones.migrationsRun).toBe(false);
  });

  it('incluye la migración del esquema base', () => {
    expect(opciones.migrations).toContain(EsquemaBase1792461934191);
  });
});
