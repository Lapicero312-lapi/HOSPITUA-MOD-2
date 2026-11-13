import { Global, type INestApplication, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../../src/application/ports/out/clock.js';
import { GUEST_DATA_REPOSITORY } from '../../src/application/ports/out/guest-data.repository.js';
import { GUEST_STAY_QUERY } from '../../src/application/ports/out/guest-stay.query.js';
import { MIGRATORY_MOVEMENT_REPOSITORY } from '../../src/application/ports/out/migratory-movement.repository.js';
import { RESERVATION_REPOSITORY } from '../../src/application/ports/out/reservation.repository.js';
import { SIRE_CONFIG } from '../../src/application/ports/out/sire-config.js';
import { SIRE_EXPORT_REPOSITORY } from '../../src/application/ports/out/sire-export.repository.js';
import { ExportSireFileModule } from '../../src/application/use-cases/export-sire-file/export-sire-file.module.js';
import {
  SELECT_FOREIGN_MOVEMENTS,
  type SireMovement,
} from '../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';
import { configureApp } from '../../src/configure-app.js';
import {
  SIRE_DEFAULTS,
  sireConfigFrom,
} from '../../src/infrastructure/config/sire.config.js';
import { SireController } from '../../src/infrastructure/in/rest/sire.controller.js';
import {
  SIRE_REQUEST_LIMITS,
  SireRequestLimits,
} from '../../src/infrastructure/in/rest/sire-rate-limiter.js';
import { ApiErrorFilter } from '../../src/infrastructure/shared/api-error.filter.js';

/**
 * T014 de `export-sire-file`: el contrato del archivo ("líneas, separador, fin de línea, codificación y
 * fechas exactos"; plan, contrato A y "Formato de la línea"; FR-005). Se comparan los **bytes** que salen
 * de `POST /api/sire/exports`, porque el archivo lo lee Migración y la codificación la aplica el
 * controlador. Son reales la ruta, `ExportSireFile`, `formatSireLine` y la conversión de las variables
 * `SIRE_*`; solo se simulan los movimientos y el registro, para arrancar con cada configuración.
 */

const PERIOD = {
  exportKind: 'PERIOD',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
};
const MOVEMENT_ID = '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b';

/** José Núñez entra: con tildes y eñe, que distinguen `utf-8` de `latin1`. */
const JOSE: SireMovement = {
  movementId: MOVEMENT_ID,
  reservationRef: 'RSV-3F9A1C7B',
  movementType: 'ENTRY',
  movementDate: '2026-10-09',
  guest: {
    firstName: 'José',
    lastName: 'Núñez',
    documentType: 'PAS',
    documentNumber: 'X99',
    birthDate: '1990-05-12',
    nationality: 'España',
    originPlace: 'Madrid, España',
    destinationPlace: 'Cartagena, Colombia',
  },
};

/** Pierre sale, sin procedencia ni destino: los dos campos quedan vacíos. */
const PIERRE: SireMovement = {
  movementId: 'c0000000-0000-4000-8000-000000000002',
  reservationRef: 'RSV-3F9A1C7B',
  movementType: 'DEPARTURE',
  movementDate: '2026-10-12',
  guest: {
    firstName: 'Pierre',
    lastName: 'Dubois',
    documentType: 'CE',
    documentNumber: 'FR123456',
    birthDate: '1985-02-03',
    nationality: 'Francia',
    originPlace: null,
    destinationPlace: null,
  },
};

/** Lo que `AppModule` pone con módulos globales: aquí no se usa la base. */
const GLOBALS = [
  SIRE_EXPORT_REPOSITORY,
  SIRE_CONFIG,
  CLOCK,
  RESERVATION_REPOSITORY,
  GUEST_DATA_REPOSITORY,
  MIGRATORY_MOVEMENT_REPOSITORY,
  GUEST_STAY_QUERY,
];

@Global()
@Module({
  providers: GLOBALS.map((token) => ({ provide: token, useValue: {} })),
  exports: GLOBALS,
})
class FakeGlobalModule {}

type Harness = {
  app: INestApplication<App>;
  movements: SireMovement[];
  insert: ReturnType<typeof vi.fn>;
};

/** La ruta real con esa configuración; `movements` es lo que entrega la selección. */
async function startWith(
  variables: Partial<Parameters<typeof sireConfigFrom>[0]>,
): Promise<Harness> {
  const movements: SireMovement[] = [];
  const insert = vi.fn((sireExport: unknown) => Promise.resolve(sireExport));
  const moduleRef = await Test.createTestingModule({
    imports: [FakeGlobalModule, ExportSireFileModule],
    controllers: [SireController],
    providers: [
      { provide: APP_FILTER, useClass: ApiErrorFilter },
      {
        provide: SIRE_REQUEST_LIMITS,
        useValue: new SireRequestLimits({ perMinute: 1000, maxConcurrent: 10 }),
      },
    ],
  })
    .overrideProvider(SIRE_CONFIG)
    .useValue(
      sireConfigFrom({
        ...SIRE_DEFAULTS,
        SIRE_HOTEL_CODE: '123456',
        SIRE_CITY_CODE: '11001',
        ...variables,
      }),
    )
    .overrideProvider(SIRE_EXPORT_REPOSITORY)
    .useValue({ insert })
    .overrideProvider(CLOCK)
    .useValue({ now: () => new Date('2026-11-02T15:30:00Z') })
    .overrideProvider(SELECT_FOREIGN_MOVEMENTS)
    .useValue({
      byPeriod: () => Promise.resolve(movements),
      byMovementId: () => Promise.resolve(movements[0] ?? null),
    })
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return { app, movements, insert };
}

/** La respuesta con sus bytes tal cual, sin decodificarlos. */
function exportFile(harness: Harness, body: object) {
  return request(harness.app.getHttpServer())
    .post('/api/sire/exports')
    .set('X-User', 'laura.mendez')
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    })
    .send(body);
}

describe('Contrato del archivo SIRE (T014)', () => {
  describe('con la configuración por defecto: tabulador, CRLF, dd/MM/yyyy y utf-8', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await startWith({});
      harness.movements.push(JOSE, PIERRE);
    });

    afterAll(async () => {
      await harness.app.close();
    });

    const JOSE_LINE =
      '123456\t11001\tPAS\tX99\tEspaña\tNÚÑEZ\tJOSÉ\tE\t09/10/2026\tMadrid, España\tCartagena, Colombia\t12/05/1990';
    const PIERRE_LINE =
      '123456\t11001\tCE\tFR123456\tFrancia\tDUBOIS\tPIERRE\tS\t12/10/2026\t\t\t03/02/1985';

    it('el archivo son exactamente esos bytes: una línea por movimiento, cada una con CRLF', async () => {
      const res = await exportFile(harness, PERIOD).expect(200);

      expect(res.body).toEqual(
        Buffer.from(`${JOSE_LINE}\r\n${PIERRE_LINE}\r\n`, 'utf8'),
      );
    });

    it('se anuncia como utf-8 y la É ocupa dos bytes', async () => {
      const res = await exportFile(harness, PERIOD).expect(200);

      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect((res.body as Buffer).includes(Buffer.from([0xc3, 0x89]))).toBe(
        true,
      );
    });

    it('cada línea tiene 12 campos, E o S, y los nombres en mayúsculas', async () => {
      const res = await exportFile(harness, PERIOD).expect(200);

      const lines = (res.body as Buffer)
        .toString('utf8')
        .split('\r\n')
        .filter((line) => line !== '')
        .map((line) => line.split('\t'));
      expect(lines.map((fields) => fields.length)).toEqual([12, 12]);
      expect(lines.map((fields) => fields[7])).toEqual(['E', 'S']);
      expect(lines.map((fields) => [fields[5], fields[6]])).toEqual([
        ['NÚÑEZ', 'JOSÉ'],
        ['DUBOIS', 'PIERRE'],
      ]);
    });

    it('la descarga individual es una sola línea con el mismo formato', async () => {
      const res = await exportFile(harness, {
        exportKind: 'SINGLE_MOVEMENT',
        movementId: MOVEMENT_ID,
      }).expect(200);

      expect(res.body).toEqual(Buffer.from(`${JOSE_LINE}\r\n`, 'utf8'));
    });
  });

  describe('con otra configuración: |, LF, yyyy-MM-dd y latin1', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await startWith({
        SIRE_FIELD_SEPARATOR: '|',
        SIRE_LINE_BREAK: 'LF',
        SIRE_DATE_FORMAT: 'yyyy-MM-dd',
        SIRE_FILE_ENCODING: 'latin1',
      });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    const useMovements = (...movements: SireMovement[]) => {
      harness.movements.length = 0;
      harness.movements.push(...movements);
      harness.insert.mockClear();
    };

    it('el archivo usa el separador, el fin de línea, las fechas y los bytes de latin1', async () => {
      useMovements(JOSE, PIERRE);

      const res = await exportFile(harness, PERIOD).expect(200);

      expect(res.body).toEqual(
        Buffer.from(
          '123456|11001|PAS|X99|España|NÚÑEZ|JOSÉ|E|2026-10-09|Madrid, España|Cartagena, Colombia|1990-05-12\n' +
            '123456|11001|CE|FR123456|Francia|DUBOIS|PIERRE|S|2026-10-12|||1985-02-03\n',
          'latin1',
        ),
      );
    });

    it('se anuncia como ISO-8859-1 y la É ocupa un solo byte', async () => {
      useMovements(JOSE);

      const res = await exportFile(harness, PERIOD).expect(200);

      expect(res.headers['content-type']).toBe(
        'text/plain; charset=ISO-8859-1',
      );
      const body = res.body as Buffer;
      expect(body.includes(Buffer.from([0xc9]))).toBe(true);
      expect(body.includes(Buffer.from([0xc3, 0x89]))).toBe(false);
    });

    it('un carácter que latin1 no puede escribir es INVALID_GUEST_CHARACTERS y no se registra', async () => {
      useMovements({
        ...JOSE,
        guest: { ...JOSE.guest, firstName: 'Łukasz' },
      });

      const res = await exportFile(harness, PERIOD).expect(400);

      expect(JSON.parse((res.body as Buffer).toString('utf8'))).toMatchObject({
        errorCode: 'INVALID_GUEST_CHARACTERS',
      });
      expect(harness.insert).not.toHaveBeenCalled();
    });

    it('un dato que contiene el separador configurado es INVALID_GUEST_CHARACTERS y no se registra', async () => {
      useMovements({
        ...JOSE,
        guest: { ...JOSE.guest, originPlace: 'Madrid | España' },
      });

      await exportFile(harness, PERIOD).expect(400);

      expect(harness.insert).not.toHaveBeenCalled();
    });
  });
});
