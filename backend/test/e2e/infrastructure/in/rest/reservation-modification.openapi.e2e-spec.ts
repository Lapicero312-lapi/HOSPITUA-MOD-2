import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import { CloseDayJob } from '../../../../../src/infrastructure/in/jobs/close-day.job.js';
import {
  MODIFICATION_CONFIRMATION_EXAMPLE,
  MODIFICATION_PREVIEW_EXAMPLE,
  MODIFICATION_REQUEST_EXAMPLE,
  ROOM_ASSIGNMENT_EXAMPLE,
} from '../../../../../src/infrastructure/in/rest/reservation-modification.dto.js';
import { aDirectReservation } from '../../../../support/builders.js';

/**
 * T032 de `update-reservation`: la documentación OpenAPI de B1, B2 y B3 (`/api/docs-json`), contra el contrato
 * B y su tabla de errores. Además de la forma del documento, comprueba que dice lo que las rutas hacen: la
 * respuesta real de B1 trae exactamente los campos documentados y los errores documentados son los que
 * responden.
 */

const PREVIEW = '/api/reservations/{reservationRef}/modification-preview';
const DETAIL = '/api/reservations/{reservationRef}';
const ASSIGNMENT = '/api/reservations/{reservationRef}/room-assignment';

type Example = { summary: string; value: Record<string, unknown> };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example>;
};
type Operation = {
  summary?: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<string, { content: Record<string, MediaType> }>;
};
type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

describe('OpenAPI de la modificación y la asignación de habitación (T032 de update-reservation)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  let reservations: ReservationRepository;

  const operation = (path: string, method: 'post' | 'patch') =>
    (document.paths[path] as Record<string, Operation>)[method];
  const ROUTES = [
    ['B1', PREVIEW, 'post'],
    ['B2', DETAIL, 'patch'],
    ['B3', ASSIGNMENT, 'patch'],
  ] as const;
  const json = (path: string, method: 'post' | 'patch', status: string) =>
    operation(path, method).responses[status].content['application/json'];
  const schema = (name: string) =>
    document.components?.schemas?.[name] as Schema;
  const fields = (name: string) => Object.keys(schema(name).properties).sort();
  const errorsOf = (path: string, method: 'post' | 'patch') =>
    json(path, method, '400').examples ?? {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // El cierre del día no corre al arrancar: la base de las e2e es compartida.
      .overrideProvider(CloseDayJob)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = (await request(app.getHttpServer()).get('/api/docs-json'))
      .body as OpenAPIObject;
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
  });

  afterAll(async () => {
    await app.close();
  });

  it('documenta B1 (POST), B2 (PATCH junto al GET del detalle) y B3 (PATCH), cada uno con 200 y 400', () => {
    expect(Object.keys(document.paths[PREVIEW])).toEqual(['post']);
    expect(Object.keys(document.paths[DETAIL]).sort()).toEqual([
      'get',
      'patch',
    ]);
    expect(Object.keys(document.paths[ASSIGNMENT])).toEqual(['patch']);
    for (const [, path, method] of ROUTES) {
      expect(Object.keys(operation(path, method).responses).sort()).toEqual([
        '200',
        '400',
      ]);
      expect(operation(path, method).summary).toBeTruthy();
    }
  });

  it('las tres piden la referencia en la ruta; solo B3 pide X-User', () => {
    const names = (path: string, method: 'post' | 'patch') =>
      operation(path, method).parameters?.map(({ name, in: where }) => [
        name,
        where,
      ]);

    expect(names(PREVIEW, 'post')).toEqual([['reservationRef', 'path']]);
    expect(names(DETAIL, 'patch')).toEqual([['reservationRef', 'path']]);
    expect(names(ASSIGNMENT, 'patch')?.sort()).toEqual([
      ['X-User', 'header'],
      ['reservationRef', 'path'],
    ]);
  });

  it('los cuerpos: el de cambio con solo updatedAt obligatorio, el de B2 con expectedRates, y el de B3; cada uno con el ejemplo del plan', () => {
    const body = (path: string, method: 'post' | 'patch') =>
      operation(path, method).requestBody?.content['application/json'];

    expect(body(PREVIEW, 'post')?.schema).toEqual({
      $ref: '#/components/schemas/ModificationRequestDto',
    });
    expect(body(PREVIEW, 'post')?.examples?.PLAN.value).toEqual(
      MODIFICATION_REQUEST_EXAMPLE,
    );
    expect(fields('ModificationRequestDto')).toEqual([
      'endDate',
      'guest',
      'notes',
      'rooms',
      'startDate',
      'updatedAt',
    ]);
    expect(schema('ModificationRequestDto').required).toEqual(['updatedAt']);
    // El titular del cambio no lleva la nacionalidad.
    expect(fields('ModificationGuestRequestDto')).not.toContain('nationality');

    expect(body(DETAIL, 'patch')?.examples?.PLAN.value).toEqual(
      MODIFICATION_CONFIRMATION_EXAMPLE,
    );
    expect(schema('ModificationConfirmationRequestDto').required).toEqual(
      expect.arrayContaining(['updatedAt', 'expectedRates']),
    );
    expect(fields('ModificationExpectedRateDto')).toEqual([
      'currency',
      'lodgingAmount',
      'roomId',
    ]);

    expect(body(ASSIGNMENT, 'patch')?.examples?.PLAN.value).toEqual(
      ROOM_ASSIGNMENT_EXAMPLE,
    );
    expect(fields('RoomAssignmentDto')).toEqual([
      'reservationRoomId',
      'roomId',
    ]);
  });

  it('las respuestas 200: B1 la vista previa con el ejemplo del plan; B2 y B3, el detalle de C3', () => {
    expect(json(PREVIEW, 'post', '200').schema).toEqual({
      $ref: '#/components/schemas/ModificationPreviewDto',
    });
    expect(json(PREVIEW, 'post', '200').example).toEqual(
      MODIFICATION_PREVIEW_EXAMPLE,
    );
    expect(Object.keys(MODIFICATION_PREVIEW_EXAMPLE).sort()).toEqual(
      fields('ModificationPreviewDto'),
    );
    expect(schema('ModificationPreviewDto').properties.quotes).toMatchObject({
      nullable: true,
    });
    for (const [path, method] of [
      [DETAIL, 'patch'],
      [ASSIGNMENT, 'patch'],
    ] as const) {
      expect(json(path, method, '200').schema).toEqual({
        $ref: '#/components/schemas/ReservationDetailDto',
      });
    }
  });

  it('los errores de cada ruta: los de la tabla de B; RATE_CHANGED solo en B2; X-User y los de B3 solo en B3', () => {
    const preview = Object.keys(errorsOf(PREVIEW, 'post'));
    const confirm = Object.keys(errorsOf(DETAIL, 'patch'));
    const assign = Object.keys(errorsOf(ASSIGNMENT, 'patch'));

    expect(preview).not.toContain('RATE_CHANGED');
    // B2: los mismos que B1, más RATE_CHANGED (que readExpectedRates puede lanzar ya en el paso 1).
    expect(confirm.filter((code) => code !== 'RATE_CHANGED')).toEqual(preview);
    expect(confirm).toContain('RATE_CHANGED');
    for (const code of [
      'RESERVATION_NOT_FOUND',
      'OTA_RESERVATION_READ_ONLY',
      'STATUS_NOT_EDITABLE',
      'CONCURRENT_UPDATE',
      'LAST_ROOM_CANNOT_BE_REMOVED',
      'NATIONALITY_NOT_EDITABLE',
      'RECALCULATION_UNAVAILABLE',
      'REQUEST_NOT_PROCESSED',
    ]) {
      expect(preview).toContain(code);
    }
    expect(assign.slice(0, 2)).toEqual(['USER_REQUIRED', 'INVALID_USER']);
    for (const code of [
      'RESERVATION_NOT_IN_CONFLICT',
      'STATUS_NOT_EDITABLE',
      'ROOM_ALREADY_ASSIGNED',
      'CATEGORY_MISMATCH',
      'GUEST_COUNT_EXCEEDS_CAPACITY',
      'ROOM_NOT_AVAILABLE',
    ]) {
      expect(assign).toContain(code);
    }
  });

  it('cada ejemplo de error tiene la forma del cuerpo de error, su código como clave y la ruta de su operación', () => {
    for (const [, path, method] of ROUTES) {
      for (const [code, { value }] of Object.entries(errorsOf(path, method))) {
        expect(Object.keys(value).sort()).toEqual([
          'errorCode',
          'message',
          'path',
          'timestamp',
        ]);
        expect(value.errorCode).toBe(code);
        expect(String(value.path)).toMatch(
          new RegExp(
            `^/api/reservations/RSV-3F9A1C7B${path.replace(DETAIL, '')}$`,
          ),
        );
      }
    }
  });

  describe('lo documentado es lo que responden las rutas', () => {
    it('B1 de verdad: la respuesta trae exactamente los campos documentados', async () => {
      const reservation = await reservations.insert(
        aDirectReservation({ startDate: '2032-07-10', endDate: '2032-07-12' }),
      );

      const res = await request(app.getHttpServer())
        .post(
          `/api/reservations/${reservation.reservationRef}/modification-preview`,
        )
        .send({ updatedAt: reservation.updatedAt, notes: 'Otra nota' })
        .expect(200);

      expect(Object.keys(res.body as object).sort()).toEqual(
        fields('ModificationPreviewDto'),
      );
      expect(Object.keys(res.body.changes as object).sort()).toEqual(
        fields('ModificationChangesDto'),
      );
      expect(Object.keys(res.body.reservation as object).sort()).toEqual(
        fields('ModificationResultingStayDto'),
      );
    });

    it('los errores documentados son los que responden: RESERVATION_NOT_FOUND en B1 y B2, USER_REQUIRED en B3', async () => {
      const body = {
        updatedAt: '2026-10-08T15:42:10.123456-05:00',
        notes: 'x',
        expectedRates: [],
      };
      const server = request(app.getHttpServer());

      const preview = await server
        .post('/api/reservations/RSV-FFFFFFFF/modification-preview')
        .send(body)
        .expect(400);
      const confirm = await server
        .patch('/api/reservations/RSV-FFFFFFFF')
        .send(body)
        .expect(400);
      const assign = await server
        .patch('/api/reservations/RSV-FFFFFFFF/room-assignment')
        .send(ROOM_ASSIGNMENT_EXAMPLE)
        .expect(400);

      const documented = (
        path: string,
        method: 'post' | 'patch',
        code: string,
      ) => {
        const { errorCode, message } = errorsOf(path, method)[code].value;
        return { errorCode, message };
      };
      expect(preview.body).toMatchObject(
        documented(PREVIEW, 'post', 'RESERVATION_NOT_FOUND'),
      );
      expect(confirm.body).toMatchObject(
        documented(DETAIL, 'patch', 'RESERVATION_NOT_FOUND'),
      );
      expect(assign.body).toMatchObject(
        documented(ASSIGNMENT, 'patch', 'USER_REQUIRED'),
      );
    });
  });
});
