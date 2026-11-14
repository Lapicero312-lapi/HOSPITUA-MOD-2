import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MODULE1_PORT,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
import { MAINTENANCE_CONCURRENCY } from '../../../../../src/application/shared/maintenance-concurrency.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/** El Módulo 1 simulado: entrega la 202 antes que la 201 y ninguna tiene mantenimientos. */
const module1: Partial<Module1Port> = {
  listRooms: () => Promise.resolve([ROOM_202, ROOM_201]),
  getMaintenances: (roomId) =>
    Promise.resolve({ roomId, available: true, conflicts: [] }),
};

/**
 * La aplicación completa (`AppModule`) con el Módulo 1 simulado: comprueba que `GET /api/rooms` está
 * conectada con su caso de uso y cómo queda documentada en OpenAPI. Los escenarios de C1 los prueba la
 * tarea #53.
 */
describe('GET /api/rooms (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODULE1_PORT)
      .useValue(module1)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con las habitaciones en orden y el total', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/rooms')
      .expect(200)
      .expect('Content-Type', /application\/json/);

    const none = {
      status: 'NONE',
      maintenanceStart: null,
      maintenanceEnd: null,
    };
    expect(res.body).toEqual({
      items: [
        { ...ROOM_201, maintenance: none },
        { ...ROOM_202, maintenance: none },
      ],
      total: 2,
    });
  });

  it('el tope de consultas de mantenimiento sale de la configuración validada: 5, su valor por defecto', () => {
    expect(app.get(MAINTENANCE_CONCURRENCY)).toBe(5);
  });

  /** El documento de `/api/docs-json` (datos de las pruebas de T016 del plan). */
  describe('en OpenAPI', () => {
    let document: OpenAPIObject;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      document = res.body as OpenAPIObject;
    });

    const responses = (): Record<string, unknown> =>
      document.paths['/api/rooms']?.get?.responses ?? {};
    const fields = (schema: string) => {
      const found = (document.components?.schemas?.[schema] ?? {}) as {
        properties?: Record<string, unknown>;
      };
      return Object.keys(found.properties ?? {}).sort();
    };

    it('declara solo la respuesta 200 y la 400', () => {
      expect(Object.keys(responses()).sort()).toEqual(['200', '400']);
    });

    it('la respuesta 200 trae items y total, con el ejemplo de C1: la 201 SCHEDULED y la 202 NONE', () => {
      const uuid = expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      expect(responses()['200']).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RoomsDto' },
            example: {
              items: [
                {
                  id: uuid,
                  roomNumber: '201',
                  categoryRoom: 'DOBLE',
                  maxCapacity: 2,
                  maintenance: {
                    status: 'SCHEDULED',
                    maintenanceStart: '2026-10-20',
                    maintenanceEnd: '2026-10-22',
                  },
                },
                {
                  id: uuid,
                  roomNumber: '202',
                  categoryRoom: 'DOBLE',
                  maxCapacity: 3,
                  maintenance: {
                    status: 'NONE',
                    maintenanceStart: null,
                    maintenanceEnd: null,
                  },
                },
              ],
              total: 2,
            },
          },
        },
      });
      expect(document.components?.schemas?.RoomsDto).toEqual({
        type: 'object',
        properties: {
          items: {
            description:
              'Ordenadas por `categoryRoom` y luego por `roomNumber`.',
            type: 'array',
            items: { $ref: '#/components/schemas/RoomDto' },
          },
          total: { type: 'integer', example: 2 },
        },
        required: ['items', 'total'],
      });
    });

    it('cada habitación trae id (UUID), roomNumber, categoryRoom con su forma, maxCapacity desde 1 y maintenance, y nada más: tampoco su estado', () => {
      expect(document.components?.schemas?.RoomDto).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          roomNumber: { type: 'string', example: '201' },
          categoryRoom: {
            type: 'string',
            pattern: '^[A-Z0-9_]{1,50}$',
            example: 'DOBLE',
          },
          maxCapacity: { type: 'integer', minimum: 1, example: 2 },
          maintenance: { $ref: '#/components/schemas/RoomMaintenanceDto' },
        },
        required: [
          'id',
          'roomNumber',
          'categoryRoom',
          'maxCapacity',
          'maintenance',
        ],
      });
    });

    it('maintenance trae status con sus tres valores y las dos fechas, que pueden ser null', () => {
      const date = (description: string, example: string) => ({
        type: 'string',
        format: 'date',
        nullable: true,
        description,
        example,
      });

      expect(document.components?.schemas?.RoomMaintenanceDto).toEqual({
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['SCHEDULED', 'NONE', 'UNAVAILABLE'],
            description:
              '`SCHEDULED`: hay un mantenimiento próximo; trae el más cercano. `NONE`: no tiene. `UNAVAILABLE`: no se pudo consultar el calendario de esa habitación; no se asume que no tiene.',
            example: 'SCHEDULED',
          },
          maintenanceStart: date(
            'Inicio del mantenimiento más cercano; `null` si no tiene o si no se pudo consultar.',
            '2026-10-20',
          ),
          maintenanceEnd: date(
            'Fin del mantenimiento más cercano; `null` si no tiene o si no se pudo consultar.',
            '2026-10-22',
          ),
        },
        required: ['status', 'maintenanceStart', 'maintenanceEnd'],
      });
    });

    it('la respuesta 400 usa el cuerpo de error, con un ejemplo de INVENTORY_UNAVAILABLE y otro de REQUEST_NOT_PROCESSED', () => {
      const body = (errorCode: string, message: string) => ({
        errorCode,
        message,
        timestamp: expect.any(String),
        path: '/api/rooms',
      });
      const json = (
        responses()['400'] as {
          content: Record<
            string,
            { schema: unknown; examples: Record<string, { value: unknown }> }
          >;
        }
      ).content['application/json'];

      expect(json.schema).toEqual({
        $ref: '#/components/schemas/ApiErrorBody',
      });
      expect(Object.keys(json.examples).sort()).toEqual([
        'INVENTORY_UNAVAILABLE',
        'REQUEST_NOT_PROCESSED',
      ]);
      // Literales del spec y del cuerpo de error.
      expect(json.examples.INVENTORY_UNAVAILABLE.value).toEqual(
        body(
          'INVENTORY_UNAVAILABLE',
          'No se pudo consultar el inventario de habitaciones en este momento. Intente de nuevo.',
        ),
      );
      expect(json.examples.REQUEST_NOT_PROCESSED.value).toEqual(
        body('REQUEST_NOT_PROCESSED', 'No fue posible procesar la solicitud.'),
      );
    });

    it('la respuesta real trae exactamente los campos documentados, en la respuesta, en cada habitación y en su maintenance', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/rooms')
        .expect(200);
      const body = res.body as {
        items: { maintenance: object }[];
      };

      expect(Object.keys(body).sort()).toEqual(fields('RoomsDto'));
      expect(body.items).toHaveLength(2);
      for (const item of body.items) {
        expect(Object.keys(item).sort()).toEqual(fields('RoomDto'));
        expect(Object.keys(item.maintenance).sort()).toEqual(
          fields('RoomMaintenanceDto'),
        );
      }
    });
  });
});
