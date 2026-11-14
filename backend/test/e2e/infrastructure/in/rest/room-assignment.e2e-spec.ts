import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLOCK,
  type Clock,
} from '../../../../../src/application/ports/out/clock.js';
import {
  MODULE1_PORT,
  type Module1Port,
} from '../../../../../src/application/ports/out/module1.port.js';
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
import { CloseDayJob } from '../../../../../src/infrastructure/in/jobs/close-day.job.js';
import {
  anOta,
  anOtaReservation,
  anOtaRoom,
} from '../../../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../../../support/rooms.js';

/** Un día operativo y una estadía de 2038, propios de esta prueba. */
const TODAY = '2038-04-01';
const clock: Clock = {
  today: () => TODAY,
  now: () => new Date('2038-04-01T15:00:00.000Z'),
};

/** El Módulo 1 simulado: la 201 y la 202 de `DOBLE`, sin mantenimientos. */
const module1: Partial<Module1Port> = {
  getRoom: (roomId) => {
    const room = [ROOM_201, ROOM_202].find(({ id }) => id === roomId);
    return room === undefined
      ? Promise.reject(new Error('no existe'))
      : Promise.resolve(room);
  },
  getMaintenances: (roomId) =>
    Promise.resolve({ roomId, available: true, conflicts: [] }),
};

/**
 * La aplicación completa (`AppModule`) con el Módulo 1 simulado y la base de Testcontainers: comprueba que
 * `PATCH /api/reservations/{reservationRef}/room-assignment` (B3 de `update-reservation`, T027) está
 * conectada con `AssignRoom`, que guarda la habitación y quita el conflicto, que C3 trae el
 * `reservationRoomId` con el que se asigna, y que sus errores salen por el filtro global.
 */
describe('PATCH /api/reservations/{reservationRef}/room-assignment (e2e)', () => {
  let app: INestApplication<App>;
  let reservation: Reservation;

  const detailOf = (ref: string) =>
    request(app.getHttpServer())
      .get(`/api/reservations/${ref}`)
      .set('X-Client', 'RECEPTIONIST');
  const assign = (ref: string, body: object, user: string | null = 'laura') => {
    const call = request(app.getHttpServer())
      .patch(`/api/reservations/${ref}/room-assignment`)
      .send(body);
    return user === null ? call : call.set('X-User', user);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      // Con el reloj fijo, el cierre del día no corre al arrancar: en la base compartida cerraría las
      // reservas que otras e2e guardaron antes de ese día (recuperación de T022 de update-reservation).
      .overrideProvider(CloseDayJob)
      .useValue({})
      .overrideProvider(MODULE1_PORT)
      .useValue(module1)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const agency = await app
      .get<OtaRepository>(OTA_REPOSITORY)
      .insert(anOta({ name: `Agencia asignación e2e ${randomUUID()}` }));
    reservation = await app
      .get<ReservationRepository>(RESERVATION_REPOSITORY)
      .insert(
        anOtaReservation(agency.id, {
          startDate: '2038-04-10',
          endDate: '2038-04-12',
          rooms: [
            anOtaRoom({
              roomId: null,
              roomNumber: null,
              categoryRoom: 'DOBLE',
              guestCount: 2,
            }),
          ],
          conflict: {
            reason: 'NO_ROOM_AVAILABLE',
            detectedAt: new Date('2038-04-01T10:00:00.000Z'),
          },
        }),
      );
  });

  afterAll(async () => {
    await app.close();
  });

  it('sin X-User: 400 USER_REQUIRED', async () => {
    const res = await assign(reservation.reservationRef, {}, null).expect(400);

    expect(res.body).toMatchObject({ errorCode: 'USER_REQUIRED' });
  });

  it('C3 trae el reservationRoomId de la habitación sin asignar; con él se le asigna la 202, se quita el conflicto y responde C3', async () => {
    const before = await detailOf(reservation.reservationRef).expect(200);
    const [unassigned] = before.body.rooms as {
      reservationRoomId: string;
      roomId: string | null;
    }[];
    expect(unassigned.roomId).toBeNull();

    const res = await assign(reservation.reservationRef, {
      updatedAt: before.body.updatedAt,
      assignments: [
        {
          reservationRoomId: unassigned.reservationRoomId,
          roomId: ROOM_202.id,
        },
      ],
    }).expect(200);

    expect(res.body.conflict).toBeNull();
    expect(res.body.rooms).toEqual([
      expect.objectContaining({
        reservationRoomId: unassigned.reservationRoomId,
        roomId: ROOM_202.id,
        roomNumber: '202',
      }),
    ]);
    expect(res.body.updatedAt).not.toBe(before.body.updatedAt);
  });

  it('ya sin conflicto: 400 RESERVATION_NOT_IN_CONFLICT por el filtro global', async () => {
    const current = await detailOf(reservation.reservationRef).expect(200);

    const res = await assign(reservation.reservationRef, {
      updatedAt: current.body.updatedAt,
      assignments: [
        {
          reservationRoomId: current.body.rooms[0].reservationRoomId,
          roomId: ROOM_201.id,
        },
      ],
    }).expect(400);

    expect(res.body).toMatchObject({
      errorCode: 'RESERVATION_NOT_IN_CONFLICT',
      message:
        'Solo se puede asignar habitación a una reserva de Booking en conflicto.',
    });
  });
});
