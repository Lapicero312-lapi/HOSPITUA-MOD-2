import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  ApiOkResponse,
  ApiResponse,
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BusinessError } from '../../../../src/domain/shared/business-error.js';
import { ApiErrorBody } from '../../../../src/infrastructure/shared/api-error.js';
import { ApiErrorFilter } from '../../../../src/infrastructure/shared/api-error.filter.js';

/** Dos rutas de prueba: una que cumple y otra que responde un error con el cuerpo documentado. */
@Controller('probe')
class ProbeController {
  @Get('ok')
  @ApiOkResponse()
  ok(): void {}

  @Get('error')
  @ApiResponse({ status: 400, type: ApiErrorBody })
  error(): never {
    // Literal del plan de generate-direct-reservation.
    throw new BusinessError(
      'AVAILABILITY_TAKEN',
      'Ya no hay disponibilidad para las fechas solicitadas.',
    );
  }
}

describe('ApiErrorBody en OpenAPI', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('documenta el cuerpo de error con sus cuatro campos', () => {
    expect(document.components?.schemas?.ApiErrorBody).toEqual({
      type: 'object',
      properties: {
        errorCode: { type: 'string', example: 'REQUEST_NOT_PROCESSED' },
        message: {
          type: 'string',
          example: 'No fue posible procesar la solicitud.',
        },
        timestamp: {
          type: 'string',
          description: 'En ISO 8601 y UTC.',
          format: 'date-time',
        },
        path: {
          type: 'string',
          description: 'Sin la consulta.',
          example: '/api/reservations',
        },
      },
      required: ['errorCode', 'message', 'timestamp', 'path'],
    });
  });

  it('la ruta que da error declara el cuerpo de error en su respuesta 400', () => {
    expect(document.paths['/probe/error']).toMatchObject({
      get: {
        responses: {
          400: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiErrorBody' },
              },
            },
          },
        },
      },
    });
  });

  it('la ruta que cumple no declara el cuerpo de error', () => {
    const responses = document.paths['/probe/ok']?.get?.responses;

    expect(responses).toHaveProperty('200');
    expect(responses).not.toHaveProperty('400');
  });

  it('la ruta que cumple responde 200', async () => {
    await get('/probe/ok').expect(200);
  });

  it('la respuesta de error tiene exactamente los campos documentados, con el timestamp en ISO 8601 y UTC', async () => {
    const res = await get('/probe/error').expect(400);
    const schema = document.components?.schemas?.ApiErrorBody as {
      properties: Record<string, unknown>;
    };

    expect(Object.keys(res.body).sort()).toEqual(
      Object.keys(schema.properties).sort(),
    );
    expect(res.body).toEqual({
      errorCode: 'AVAILABILITY_TAKEN',
      message: 'Ya no hay disponibilidad para las fechas solicitadas.',
      timestamp: expect.any(String),
      path: '/probe/error',
    });
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });
});
