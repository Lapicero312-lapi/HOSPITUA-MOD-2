import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Room } from '../../../../src/application/integration/room.js';
import type { Reservation } from '../../../../src/domain/reservation/reservation.js';
import { Money } from '../../../../src/domain/shared/money.js';
import { aDirectReservation, aDirectRoom } from '../../../support/builders.js';
import { ROOM_201, ROOM_202 } from '../../../support/rooms.js';
import { truncateAllTables } from '../../support/database.js';
import {
  type ModificationApp,
  type ModificationHttp,
  modificationHttp,
  plusDays,
  ROOM_203,
  startModificationApp,
  SUITE_305,
} from '../../support/modification-app.js';

/** Un día operativo de 2037, propio de esta prueba; una estadía de dos noches, días después. */
const TODAY = '2037-01-10';
const START = '2037-01-20';
const END = '2037-01-22';

/** Lo que cotiza el Módulo 3 simulado por noche: 300000.00, dos noches 600000.00. */
const LODGING_TWO_NIGHTS = '600000.00';

type QuotedRoom = {
  key: string;
  categoryRoom: string;
  nights: number;
  nightlyRates: { date: string; rate: { amount: string; currency: string } }[];
  lodgingAmount: { amount: string; currency: string };
};

/**
 * T014 y T015 de `calculate-dynamic-rate`: la recotización de una reserva que se modifica (historia 2, escenarios
 * 1 a 4) y el Módulo 3 caído durante la recotización (caso borde), con FR-002a ("todo o nada") y D1 (la
 * tarifa que cambió). La recotización la dispara `update-reservation` (B1 y B2), así que se prueba por esas
 * rutas, como lo hace la pantalla: la aplicación completa, PostgreSQL y RabbitMQ reales y los Módulos 1 y 3
 * simulados en HTTP, que cuentan cada cotización pedida.
 */
describe('calculate-dynamic-rate: la recotización de una reserva modificada (T014 y T015)', () => {
  let ctx: ModificationApp;
  let api: ModificationHttp;

  /** Una habitación guardada, con la tarifa y el `quoteId` con que se reservó. */
  const roomOf = (room: Room, guestCount: number, quoteId: string) =>
    aDirectRoom({
      roomId: room.id,
      roomNumber: room.roomNumber,
      categoryRoom: room.categoryRoom,
      guestCount,
      rate: { roomGrossAmount: Money.of('500000.00', 'COP'), quoteId },
    });

  /** Una reserva directa `ACTIVE` con la 201 y la 202, cada una con su tarifa vigente. */
  const stored = (
    rooms = [roomOf(ROOM_201, 2, 'Q-201'), roomOf(ROOM_202, 2, 'Q-202')],
  ) =>
    ctx.reservations.insert(
      aDirectReservation({ startDate: START, endDate: END, rooms }),
    );

  /** Todo lo guardado de la reserva que toca la recotización: fechas, `updatedAt` y la tarifa de cada habitación. */
  const snapshotOf = async ({ id }: Reservation) => ({
    reservation: (
      (await ctx.dataSource.query(
        `SELECT start_date::text, end_date::text, updated_at::text FROM reservation WHERE id = $1`,
        [id],
      )) as Record<string, unknown>[]
    )[0],
    rooms: (await ctx.dataSource.query(
      `SELECT room_number, category_room, room_gross_amount::text AS amount, quote_id
       FROM reservation_room WHERE reservation_id = $1 ORDER BY room_number`,
      [id],
    )) as Record<string, unknown>[],
  });

  /** Las tarifas que vio el solicitante en la vista previa, como las envía la pantalla al confirmar. */
  const expectedRatesOf = (quotes: { rooms: QuotedRoom[] } | null) =>
    (quotes?.rooms ?? []).map(({ key, lodgingAmount }) => ({
      roomId: key,
      lodgingAmount: lodgingAmount.amount,
      currency: lodgingAmount.currency,
    }));

  beforeAll(async () => {
    ctx = await startModificationApp(TODAY);
    api = modificationHttp(ctx.app);
  });

  beforeEach(async () => {
    ctx.resetModules();
    await truncateAllTables(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('historia 2', () => {
    it('escenario 1: se amplían las fechas: una cotización por habitación (todas), se muestran, y solo al confirmar se guardan las tarifas y los quoteId nuevos', async () => {
      const reservation = await stored();
      const before = await snapshotOf(reservation);
      const change = {
        updatedAt: reservation.updatedAt,
        endDate: plusDays(END, 1),
      };

      const shown = await api
        .preview(reservation.reservationRef, change)
        .expect(200);

      // Una cotización por habitación, de la categoría de cada una y con las fechas nuevas.
      expect(ctx.modules.quotedTypes).toEqual(['DOBLE', 'DOBLE']);
      const quoted = shown.body.quotes.rooms as QuotedRoom[];
      expect(quoted.map(({ key }) => key).sort()).toEqual(
        [ROOM_201.id, ROOM_202.id].sort(),
      );
      for (const room of quoted) {
        expect(room).toMatchObject({
          categoryRoom: 'DOBLE',
          nights: 3,
          lodgingAmount: { amount: '900000.00', currency: 'COP' },
        });
        expect(room.nightlyRates.map(({ date }) => date)).toEqual([
          START,
          plusDays(START, 1),
          END,
        ]);
      }
      // Mostrar no guarda: la reserva sigue igual.
      expect(await snapshotOf(reservation)).toEqual(before);

      await api
        .confirm(reservation.reservationRef, {
          ...change,
          expectedRates: expectedRatesOf(shown.body.quotes),
        })
        .expect(200);

      const after = await snapshotOf(reservation);
      expect(after.reservation).toMatchObject({ end_date: plusDays(END, 1) });
      expect(after.reservation?.updated_at).not.toBe(
        before.reservation?.updated_at,
      );
      for (const room of after.rooms) {
        expect(room.amount).toBe('900000.00');
        // El quoteId es el nuevo, el del Módulo 3 al confirmar: ni el de la reserva ni el de la vista previa.
        expect(room.quote_id).not.toMatch(/^Q-20[12]$/);
      }
      expect(new Set(after.rooms.map(({ quote_id }) => quote_id)).size).toBe(2);
    });

    it('escenario 2: el solicitante no confirma: las cotizaciones se descartan y la reserva queda exactamente igual', async () => {
      const reservation = await stored();
      const before = await snapshotOf(reservation);

      await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          endDate: plusDays(END, 1),
        })
        .expect(200);

      expect(ctx.modules.quotedTypes).toHaveLength(2);
      expect(await snapshotOf(reservation)).toEqual(before);
    });

    it('escenario 3a: cambiar una habitación a otra categoría (SUITE): se cotiza solo esa, con el desglose y sin tarifa anterior ni diferencia', async () => {
      const reservation = await stored();
      ctx.modules.nightly = '480000.00';

      const shown = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          rooms: [
            { roomId: ROOM_201.id, guestCount: 2 },
            { roomId: SUITE_305.id, guestCount: 2 },
          ],
        })
        .expect(200);

      expect(ctx.modules.quotedTypes).toEqual(['SUITE']);
      const quoted = shown.body.quotes.rooms as QuotedRoom[];
      expect(quoted).toHaveLength(1);
      // El mismo detalle que al crear la reserva, y nada más.
      expect(Object.keys(quoted[0]).sort()).toEqual([
        'categoryRoom',
        'key',
        'lodgingAmount',
        'nightlyRates',
        'nights',
      ]);
      expect(quoted[0]).toMatchObject({
        key: SUITE_305.id,
        categoryRoom: 'SUITE',
        nights: 2,
        lodgingAmount: { amount: '960000.00', currency: 'COP' },
      });
      expect(quoted[0].nightlyRates).toHaveLength(2);
      // El total suma la que se conserva (500000.00) y la nueva; no se muestra diferencia.
      expect(shown.body.quotes.total).toEqual({
        amount: '1460000.00',
        currency: 'COP',
      });
    });

    it('escenario 3b: agregar una habitación: se cotiza solo la agregada', async () => {
      const reservation = await stored([roomOf(ROOM_201, 2, 'Q-201')]);

      const shown = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          rooms: [
            { roomId: ROOM_201.id, guestCount: 2 },
            { roomId: ROOM_203.id, guestCount: 1 },
          ],
        })
        .expect(200);

      expect(ctx.modules.quotedTypes).toEqual(['DOBLE']);
      expect(
        (shown.body.quotes.rooms as QuotedRoom[]).map(({ key }) => key),
      ).toEqual([ROOM_203.id]);
      expect(
        (shown.body.quotes.rooms as QuotedRoom[])[0].lodgingAmount.amount,
      ).toBe(LODGING_TWO_NIGHTS);
    });

    it('escenario 4: cambiar una habitación por otra de la misma categoría sin cambiar las fechas: no llama al Módulo 3 ni muestra tarifa, y la tarifa vigente se conserva', async () => {
      const reservation = await stored();

      const { shown, confirmed } = await api.previewAndConfirm(
        reservation.reservationRef,
        {
          updatedAt: reservation.updatedAt,
          rooms: [
            { roomId: ROOM_201.id, guestCount: 2 },
            { roomId: ROOM_203.id, guestCount: 2 },
          ],
        },
      );

      expect(shown.body.quotes).toBeNull();
      expect(shown.body.requiresConfirmation).toBe(false);
      expect(confirmed.status).toBe(200);
      expect(ctx.modules.quotedTypes).toEqual([]);
      // La 203 hereda la tarifa y el quoteId de la 202.
      expect((await snapshotOf(reservation)).rooms).toEqual([
        expect.objectContaining({
          room_number: '201',
          amount: '500000.00',
          quote_id: 'Q-201',
        }),
        expect.objectContaining({
          room_number: '203',
          amount: '500000.00',
          quote_id: 'Q-202',
        }),
      ]);
    });
  });

  describe('el Módulo 3 cae durante la recotización (caso borde, T015)', () => {
    const NOT_AVAILABLE = {
      errorCode: 'RECALCULATION_UNAVAILABLE',
      message:
        'No se pudo calcular la nueva tarifa en este momento. Intente más tarde.',
    };

    it('en la vista previa: 400 RECALCULATION_UNAVAILABLE con el mensaje literal, y nada cambia', async () => {
      const reservation = await stored();
      const before = await snapshotOf(reservation);
      ctx.modules.module3Down = true;

      const { body } = await api
        .preview(reservation.reservationRef, {
          updatedAt: reservation.updatedAt,
          endDate: plusDays(END, 1),
        })
        .expect(400);

      expect(body).toMatchObject(NOT_AVAILABLE);
      expect(await snapshotOf(reservation)).toEqual(before);
    });

    it('al confirmar, después de una vista previa que salió bien: 400 RECALCULATION_UNAVAILABLE, no se aplica ningún cambio y se conservan las tarifas', async () => {
      const reservation = await stored();
      const before = await snapshotOf(reservation);
      const change = {
        updatedAt: reservation.updatedAt,
        endDate: plusDays(END, 1),
      };
      const shown = await api
        .preview(reservation.reservationRef, change)
        .expect(200);
      ctx.modules.module3Down = true;

      const { body } = await api
        .confirm(reservation.reservationRef, {
          ...change,
          expectedRates: expectedRatesOf(shown.body.quotes),
        })
        .expect(400);

      expect(body).toMatchObject(NOT_AVAILABLE);
      expect(await snapshotOf(reservation)).toEqual(before);
    });

    it('FR-002a, todo o nada: de tres cotizaciones falla la segunda, y ninguna tarifa se guarda', async () => {
      const reservation = await stored([
        roomOf(ROOM_201, 2, 'Q-201'),
        roomOf(ROOM_202, 2, 'Q-202'),
        roomOf(ROOM_203, 2, 'Q-203'),
      ]);
      const before = await snapshotOf(reservation);
      const change = {
        updatedAt: reservation.updatedAt,
        endDate: plusDays(END, 1),
      };
      const shown = await api
        .preview(reservation.reservationRef, change)
        .expect(200);
      // Las tres de la vista previa son las llamadas 1 a 3: al confirmar, falla la 5 (la segunda de tres).
      ctx.modules.failingQuoteCalls = [5];

      const { body } = await api
        .confirm(reservation.reservationRef, {
          ...change,
          expectedRates: expectedRatesOf(shown.body.quotes),
        })
        .expect(400);

      expect(ctx.modules.quotedTypes).toHaveLength(6);
      expect(body).toMatchObject(NOT_AVAILABLE);
      expect(await snapshotOf(reservation)).toEqual(before);
    });
  });

  it('D1: la tarifa cambió entre la vista previa y la confirmación: 400 RATE_CHANGED y nada se guarda', async () => {
    const reservation = await stored();
    const before = await snapshotOf(reservation);
    const change = {
      updatedAt: reservation.updatedAt,
      endDate: plusDays(END, 1),
    };
    const shown = await api
      .preview(reservation.reservationRef, change)
      .expect(200);
    ctx.modules.nightly = '310000.00';

    const { body } = await api
      .confirm(reservation.reservationRef, {
        ...change,
        expectedRates: expectedRatesOf(shown.body.quotes),
      })
      .expect(400);

    expect(body).toMatchObject({
      errorCode: 'RATE_CHANGED',
      message: 'La tarifa cambió, vuelva a cotizar.',
    });
    expect(await snapshotOf(reservation)).toEqual(before);
  });
});
