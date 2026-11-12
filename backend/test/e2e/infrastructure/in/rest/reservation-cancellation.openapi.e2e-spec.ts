import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OTA_REPOSITORY,
  type OtaRepository,
} from '../../../../../src/application/ports/out/ota.repository.js';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../../../../../src/application/ports/out/reservation.repository.js';
import { AppModule } from '../../../../../src/app.module.js';
import { configureApp } from '../../../../../src/configure-app.js';
import type { Reservation } from '../../../../../src/domain/reservation/reservation.js';
import {
  aDirectReservation,
  anOta,
  anOtaReservation,
  otaTerms,
} from '../../../../support/builders.js';

/**
 * T015 de `cancel-reservation`: la documentación OpenAPI de A (`/api/docs-json`), contra el contrato A, la
 * tabla C y el punto 11 del plan. Además de la forma del documento, comprueba que dice lo que la ruta hace:
 * cada ejemplo de error documentado es el que la ruta responde, y la respuesta real trae exactamente los
 * campos documentados. B no tiene ruta, así que no aparece. Las reservas llegan en 2032, que no usa ninguna
 * otra prueba e2e de la cancelación, para no tocar la lista del día.
 */

const CANCELLATION = '/api/reservations/{reservationRef}/cancellation';

/** El cuerpo y la respuesta del ejemplo de A del plan. */
const PLAN_REQUEST = {
  updatedAt: '2026-10-08T15:42:10.123456-05:00',
  acknowledged: true,
  reason: 'El huésped cambió de planes',
};

type Example = { summary: string; value: Record<string, unknown> };
type MediaType = {
  schema?: Record<string, unknown>;
  example?: unknown;
  examples?: Record<string, Example>;
};
type Operation = {
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema?: Record<string, unknown>;
  }[];
  requestBody?: { required?: boolean; content: Record<string, MediaType> };
  responses: Record<string, { content: Record<string, MediaType> }>;
};
type Schema = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

describe('OpenAPI de la cancelación de la Recepcionista (T015 de cancel-reservation)', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;
  let reservations: ReservationRepository;
  let otaId: string;

  const operation = () =>
    (document.paths[CANCELLATION] as Record<string, Operation>).post;
  const json = (status: string) =>
    operation().responses[status].content['application/json'];
  const schema = (name: string) =>
    document.components?.schemas?.[name] as Schema;
  const fields = (name: string) => Object.keys(schema(name).properties).sort();
  const errorExample = (code: string) => {
    const example = json('400').examples?.[code];
    if (example === undefined) {
      throw new Error(`A no documenta ${code}`);
    }
    return example.value;
  };

  /** Una reserva directa nueva, guardada, con llegada en 2032. */
  const aStoredReservation = (status: 'ACTIVE' | 'IN_PROGRESS' = 'ACTIVE') =>
    reservations.insert(
      aDirectReservation({
        status,
        startDate: '2032-03-10',
        endDate: '2032-03-12',
      }),
    );

  const cancel = (
    reservationRef: string,
    body: object,
    user: string | null = 'laura.mendez',
  ) => {
    const call = request(app.getHttpServer()).post(
      `/api/reservations/${reservationRef}/cancellation`,
    );
    return (user === null ? call : call.set('X-User', user)).send(body);
  };

  /** El cuerpo del ejemplo del plan con el `updatedAt` que guardó la base. */
  const bodyFor = (reservation: Reservation, changes: object = {}) => ({
    ...PLAN_REQUEST,
    updatedAt: reservation.updatedAt,
    ...changes,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    document = (await request(app.getHttpServer()).get('/api/docs-json'))
      .body as OpenAPIObject;
    reservations = app.get<ReservationRepository>(RESERVATION_REPOSITORY);
    // La base de las e2e es compartida: una agencia propia, para no chocar con el nombre único.
    otaId = (
      await app
        .get<OtaRepository>(OTA_REPOSITORY)
        .insert(anOta({ name: `Agencia cancelación e2e ${randomUUID()}` }))
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('documenta A con solo sus respuestas 200 y 400, y B no aparece porque no tiene ruta', () => {
    expect(Object.keys(document.paths[CANCELLATION])).toEqual(['post']);
    expect(Object.keys(operation().responses).sort()).toEqual(['200', '400']);
    expect(
      Object.keys(document.paths).filter((path) => path.includes('cancel')),
    ).toEqual([CANCELLATION]);
  });

  it('pide la referencia en la ruta, con su formato, y la cabecera X-User', () => {
    expect(
      operation().parameters?.map(({ name, in: where, required }) => ({
        name,
        where,
        required,
      })),
    ).toEqual([
      { name: 'X-User', where: 'header', required: true },
      { name: 'reservationRef', where: 'path', required: true },
    ]);
    expect(
      operation().parameters?.find(({ name }) => name === 'reservationRef')
        ?.schema,
    ).toEqual({ type: 'string', pattern: '^RSV-[0-9A-F]{8}$' });
  });

  it('el cuerpo es ReservationCancellationRequestDto, con updatedAt y acknowledged obligatorios y el ejemplo del plan', () => {
    const body = operation().requestBody;

    expect(body?.required).toBe(true);
    const media = body?.content['application/json'];
    expect(media?.schema).toEqual({
      $ref: '#/components/schemas/ReservationCancellationRequestDto',
    });
    expect(Object.keys(media?.examples ?? {})).toEqual(['PLAN']);
    expect(media?.examples?.PLAN.value).toEqual(PLAN_REQUEST);
    expect(fields('ReservationCancellationRequestDto')).toEqual([
      'acknowledged',
      'reason',
      'updatedAt',
    ]);
    expect(schema('ReservationCancellationRequestDto').required).toEqual([
      'updatedAt',
      'acknowledged',
    ]);
    expect(
      schema('ReservationCancellationRequestDto').properties.reason,
    ).toMatchObject({ type: 'string', nullable: true, maxLength: 500 });
    expect(
      schema('ReservationCancellationRequestDto').properties.acknowledged,
    ).toMatchObject({ type: 'boolean' });
  });

  it('la respuesta 200 es ReservationCancellationDto, con los campos y el ejemplo de A', () => {
    expect(json('200').schema).toEqual({
      $ref: '#/components/schemas/ReservationCancellationDto',
    });
    expect(json('200').example).toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      status: 'CANCELLED',
      cancellation: {
        cancellationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ) as string,
        cancellationDate: '2026-10-09T10:15:20-05:00',
        channel: 'RECEPTION',
        reason: 'El huésped cambió de planes',
        processedBy: 'laura.mendez',
        status: 'COMPLETED',
      },
    });
    expect(fields('ReservationCancellationDto')).toEqual([
      'cancellation',
      'reservationRef',
      'status',
    ]);
    expect(fields('CancellationDto')).toEqual([
      'cancellationDate',
      'cancellationId',
      'channel',
      'processedBy',
      'reason',
      'status',
    ]);
    expect(
      schema('ReservationCancellationDto').properties.cancellation,
    ).toEqual({ $ref: '#/components/schemas/CancellationDto' });
    expect(schema('CancellationDto').properties.channel).toMatchObject({
      enum: ['RECEPTION'],
    });
  });

  it('los errores 400 son los de la tabla C, con la cabecera primero y después el orden de la regla 3', () => {
    expect(json('400').schema).toEqual({
      $ref: '#/components/schemas/ApiErrorBody',
    });
    expect(Object.keys(json('400').examples ?? {})).toEqual([
      'USER_REQUIRED',
      'INVALID_USER',
      'RESERVATION_REF_REQUIRED',
      'INVALID_RESERVATION_CODE',
      'REASON_TOO_LONG',
      'INVALID_CHARACTERS',
      'RESERVATION_NOT_FOUND',
      'OTA_RESERVATION_CANCEL_VIA_API',
      'CANCELLATION_NOT_CONFIRMED',
      'CONCURRENT_UPDATE',
      'STATUS_NOT_CANCELLABLE',
      'REQUEST_NOT_PROCESSED',
    ]);
  });

  it('la respuesta real trae exactamente los campos documentados', async () => {
    const reservation = await aStoredReservation();

    const res = await cancel(
      reservation.reservationRef,
      bodyFor(reservation),
    ).expect(200);
    const body = res.body as { cancellation: object };

    expect(Object.keys(body).sort()).toEqual(
      fields('ReservationCancellationDto'),
    );
    expect(Object.keys(body.cancellation).sort()).toEqual(
      fields('CancellationDto'),
    );
  });

  describe('cada error documentado es el que la ruta responde', () => {
    /** Lo que se compara: el código y el mensaje, sin la hora. */
    const comparable = (body: Record<string, unknown>) => ({
      errorCode: body.errorCode,
      message: body.message,
    });

    it.each([
      [
        'USER_REQUIRED',
        async () => {
          const reservation = await aStoredReservation();
          return cancel(reservation.reservationRef, bodyFor(reservation), null);
        },
      ],
      [
        'INVALID_USER',
        async () => {
          const reservation = await aStoredReservation();
          return cancel(
            reservation.reservationRef,
            bodyFor(reservation),
            'x'.repeat(101),
          );
        },
      ],
      [
        'INVALID_RESERVATION_CODE',
        () => Promise.resolve(cancel('RSV-123', PLAN_REQUEST)),
      ],
      [
        'REASON_TOO_LONG',
        async () => {
          const reservation = await aStoredReservation();
          return cancel(
            reservation.reservationRef,
            bodyFor(reservation, { reason: 'x'.repeat(501) }),
          );
        },
      ],
      [
        'INVALID_CHARACTERS',
        async () => {
          const reservation = await aStoredReservation();
          return cancel(
            reservation.reservationRef,
            bodyFor(reservation, { reason: 'Cambio\u0000de planes' }),
          );
        },
      ],
      [
        'RESERVATION_NOT_FOUND',
        () => Promise.resolve(cancel('RSV-3F9A1C7B', PLAN_REQUEST)),
      ],
      [
        'OTA_RESERVATION_CANCEL_VIA_API',
        async () => {
          const reservation = await reservations.insert(
            anOtaReservation(otaId, {
              startDate: '2032-03-10',
              endDate: '2032-03-12',
              ota: otaTerms(otaId, {
                externalConfirmationCode: randomUUID().slice(0, 10),
              }),
            }),
          );
          return cancel(reservation.reservationRef, bodyFor(reservation));
        },
      ],
      [
        'CANCELLATION_NOT_CONFIRMED',
        async () => {
          const reservation = await aStoredReservation();
          return cancel(
            reservation.reservationRef,
            bodyFor(reservation, { acknowledged: false }),
          );
        },
      ],
      [
        'CONCURRENT_UPDATE',
        async () => {
          const reservation = await aStoredReservation();
          return cancel(
            reservation.reservationRef,
            bodyFor(reservation, { updatedAt: PLAN_REQUEST.updatedAt }),
          );
        },
      ],
      [
        'STATUS_NOT_CANCELLABLE',
        async () => {
          const reservation = await aStoredReservation('IN_PROGRESS');
          return cancel(reservation.reservationRef, bodyFor(reservation));
        },
      ],
    ])('%s', async (code, send) => {
      // Esperar la solicitud la envía: `res` ya es la respuesta.
      const res = await send();

      expect(res.status).toBe(400);
      expect(comparable(res.body as Record<string, unknown>)).toEqual(
        comparable(errorExample(code)),
      );
    });

    it('RESERVATION_REF_REQUIRED, con la ruta del ejemplo', async () => {
      const res = await cancel('', PLAN_REQUEST).expect(400);

      expect(res.body).toMatchObject({
        errorCode: 'RESERVATION_REF_REQUIRED',
        message: errorExample('RESERVATION_REF_REQUIRED').message,
        path: errorExample('RESERVATION_REF_REQUIRED').path,
      });
    });

    it('la ruta de cada ejemplo es la de la reserva que falla', async () => {
      const res = await cancel('RSV-3F9A1C7B', PLAN_REQUEST).expect(400);
      expect(res.body).toMatchObject({
        path: errorExample('RESERVATION_NOT_FOUND').path,
      });
      const invalid = await cancel('RSV-123', PLAN_REQUEST).expect(400);
      expect(invalid.body).toMatchObject({
        path: errorExample('INVALID_RESERVATION_CODE').path,
      });
    });
  });
});
