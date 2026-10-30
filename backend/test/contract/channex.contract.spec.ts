import { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { BookingRevision } from '../../src/application/integration/booking-revision.js';
import {
  ChannexRateLimitedError,
  ChannexRejectedError,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../src/application/ports/out/channex.port.js';
import { ChannexHttpAdapter } from '../../src/infrastructure/out/channex/channex-http.adapter.js';

const BASE_URL = 'http://channex.test';
const API_KEY = 'clave-de-prueba-que-no-debe-salir';
const PROPERTY_ID = '716305c4-561a-4561-a187-7f5b8aeb5920';
const OTHER_PROPERTY_ID = '2941337f-50d6-4189-ae13-f76efaf9c515';
const ROOM_TYPE_ID = '994d1375-dbbd-4072-8724-b2ab32ce781b';
const REVISION_ID = '03dd7198-c5b7-493c-a889-74d0c2211de7';
const BOOKING_ID = 'cfa33f3b-bd32-4b90-8ef9-bde2bfe986cd';
const TIMEOUT_MS = 200;

const SETTINGS = {
  CHANNEX_BASE_URL: BASE_URL,
  CHANNEX_API_KEY: API_KEY,
  CHANNEX_PROPERTY_ID: PROPERTY_ID,
};

/** Solo lo que lee el adaptador de `ConfigService`. */
const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;

const newAdapter = (values: Record<string, string | undefined> = SETTINGS) =>
  new ChannexHttpAdapter(
    new HttpService(axios.create({ timeout: TIMEOUT_MS })),
    configWith(values),
  );

const channexError = (code: string, title: string) => ({
  errors: { code, title },
});

/** Una revisión del ejemplo de `generate-ota-reservation` (A1); los valores son ilustrativos. */
const aRevision = (attributes: Record<string, unknown> = {}) => ({
  type: 'booking_revision',
  id: REVISION_ID,
  attributes: {
    id: REVISION_ID,
    booking_id: BOOKING_ID,
    ota_reservation_code: '9996013801',
    ota_name: 'Booking.com',
    status: 'new',
    arrival_date: '2026-11-10',
    departure_date: '2026-11-12',
    amount: '220.00',
    ota_commission: '33.00',
    currency: 'USD',
    notes: 'Llegada tarde',
    customer: {
      name: 'Ana',
      surname: 'Pérez',
      mail: 'ana@correo.com',
      phone: '+57 300 000 0000',
      country: 'CO',
    },
    rooms: [
      {
        room_type_id: ROOM_TYPE_ID,
        rate_plan_id: '445835fb-7956-42ac-9efc-3e6f331f0808',
        checkin_date: '2026-11-10',
        checkout_date: '2026-11-12',
        occupancy: { adults: 2, children: 0, infants: 0 },
      },
    ],
    ...attributes,
  },
});

const feed = (data: unknown[], total = data.length) => ({
  meta: { total, page: 1, limit: 100 },
  data,
});

const server = setupServer();

describe('ChannexHttpAdapter contra respuestas simuladas de Channex', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  describe('configure-ota', () => {
    it('A0: lista las propiedades de la cuenta con la cabecera user-api-key', async () => {
      let apiKey: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/v1/properties/options`, ({ request }) => {
          apiKey = request.headers.get('user-api-key');
          return HttpResponse.json({
            data: [
              {
                type: 'property',
                id: PROPERTY_ID,
                attributes: {
                  id: PROPERTY_ID,
                  title: 'Hotel de prueba',
                  currency: 'USD',
                },
              },
            ],
          });
        }),
      );

      await expect(newAdapter().listProperties()).resolves.toEqual([
        { id: PROPERTY_ID, title: 'Hotel de prueba' },
      ]);
      expect(apiKey).toBe(API_KEY);
    });

    it('A1: pide los tipos con filter[property_id] y descarta los de otras propiedades', async () => {
      let filter: string | null = null;
      const roomType = (id: string, propertyId: string, title: string) => ({
        type: 'room_type',
        id,
        attributes: {
          id,
          property_id: propertyId,
          title,
          default_occupancy: 2,
        },
      });
      server.use(
        http.get(`${BASE_URL}/api/v1/room_types/options`, ({ request }) => {
          filter = new URL(request.url).searchParams.get('filter[property_id]');
          return HttpResponse.json({
            data: [
              roomType(ROOM_TYPE_ID, PROPERTY_ID, 'DOBLE'),
              roomType(
                'f1e2d3c4-b5a6-4978-8a6b-5c4d3e2f1a0b',
                OTHER_PROPERTY_ID,
                'SUITE',
              ),
            ],
          });
        }),
      );

      await expect(newAdapter().listRoomTypes()).resolves.toEqual([
        { id: ROOM_TYPE_ID, title: 'DOBLE', defaultOccupancy: 2 },
      ]);
      expect(filter).toBe(PROPERTY_ID);
    });

    it('A2: crea el tipo con el cuerpo del plan y devuelve el tipo creado (201)', async () => {
      let sent: unknown = null;
      server.use(
        http.post(`${BASE_URL}/api/v1/room_types`, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json(
            {
              data: {
                type: 'room_type',
                id: ROOM_TYPE_ID,
                attributes: {
                  id: ROOM_TYPE_ID,
                  title: 'DOBLE',
                  occ_adults: 3,
                  default_occupancy: 3,
                  count_of_rooms: 3,
                },
              },
            },
            { status: 201 },
          );
        }),
      );

      const created = await newAdapter().createRoomType({
        title: 'DOBLE',
        countOfRooms: 3,
        occupancy: 3,
      });

      expect(sent).toEqual({
        room_type: {
          property_id: PROPERTY_ID,
          title: 'DOBLE',
          count_of_rooms: 3,
          occ_adults: 3,
          occ_children: 0,
          occ_infants: 0,
          default_occupancy: 3,
          room_kind: 'room',
        },
      });
      expect(created).toEqual({
        id: ROOM_TYPE_ID,
        title: 'DOBLE',
        defaultOccupancy: 3,
      });
    });

    it('A3: actualiza el tipo por su id con los mismos campos', async () => {
      let sent: unknown = null;
      server.use(
        http.put(
          `${BASE_URL}/api/v1/room_types/${ROOM_TYPE_ID}`,
          async ({ request }) => {
            sent = await request.json();
            return HttpResponse.json({ data: { id: ROOM_TYPE_ID } });
          },
        ),
      );

      await newAdapter().updateRoomType(ROOM_TYPE_ID, {
        title: 'DOBLE',
        countOfRooms: 4,
        occupancy: 2,
      });

      expect(sent).toMatchObject({
        room_type: {
          property_id: PROPERTY_ID,
          count_of_rooms: 4,
          occ_adults: 2,
        },
      });
    });

    it('A3: si Channex rechaza bajar la capacidad (422) es ChannexRejectedError con su código', async () => {
      server.use(
        http.put(`${BASE_URL}/api/v1/room_types/${ROOM_TYPE_ID}`, () =>
          HttpResponse.json(
            channexError('validation_error', 'Validation Error'),
            { status: 422 },
          ),
        ),
      );

      await expect(
        newAdapter().updateRoomType(ROOM_TYPE_ID, {
          title: 'DOBLE',
          countOfRooms: 4,
          occupancy: 1,
        }),
      ).rejects.toEqual(new ChannexRejectedError(422, 'validation_error'));
    });

    it('A4: envía la disponibilidad por rangos con la propiedad y devuelve meta.warnings', async () => {
      let sent: unknown = null;
      const warning = {
        room_type_id: ROOM_TYPE_ID,
        warning: { availability: ['must be >= 0'] },
      };
      server.use(
        http.post(`${BASE_URL}/api/v1/availability`, async ({ request }) => {
          sent = await request.json();
          return HttpResponse.json({
            data: [
              { id: 'eb31d631-4fcc-478a-80c3-bf7a2acf0699', type: 'task' },
            ],
            meta: { message: 'Success', warnings: [warning] },
          });
        }),
      );

      const result = await newAdapter().pushAvailability([
        {
          roomTypeId: ROOM_TYPE_ID,
          dateFrom: '2026-11-10',
          dateTo: '2026-11-11',
          availability: 2,
        },
      ]);

      expect(sent).toEqual({
        values: [
          {
            property_id: PROPERTY_ID,
            room_type_id: ROOM_TYPE_ID,
            date_from: '2026-11-10',
            date_to: '2026-11-11',
            availability: 2,
          },
        ],
      });
      expect(result).toEqual({ warnings: [JSON.stringify(warning)] });
    });
  });

  describe('generate-ota-reservation', () => {
    it('A1: pide la página del feed de la propiedad, de la más antigua, de 100 en 100', async () => {
      let params: URLSearchParams | null = null;
      server.use(
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, ({ request }) => {
          params = new URL(request.url).searchParams;
          return HttpResponse.json(feed([aRevision()], 101));
        }),
      );

      const page = await newAdapter().fetchBookingFeed(2);

      expect(Object.fromEntries(params ?? [])).toEqual({
        'filter[property_id]': PROPERTY_ID,
        'order[inserted_at]': 'asc',
        'pagination[page]': '2',
        'pagination[limit]': '100',
      });
      expect(page.total).toBe(101);
      expect(page.revisions).toHaveLength(1);
      const [revision] = page.revisions;
      expect(revision).toMatchObject({
        id: REVISION_ID,
        bookingId: BOOKING_ID,
        otaReservationCode: '9996013801',
        otaName: 'Booking.com',
        status: 'new',
        arrivalDate: '2026-11-10',
        departureDate: '2026-11-12',
        notes: 'Llegada tarde',
        customer: {
          name: 'Ana',
          surname: 'Pérez',
          mail: 'ana@correo.com',
          phone: '+57 300 000 0000',
          country: 'CO',
        },
        rooms: [
          {
            roomTypeId: ROOM_TYPE_ID,
            ratePlanId: '445835fb-7956-42ac-9efc-3e6f331f0808',
            checkinDate: '2026-11-10',
            checkoutDate: '2026-11-12',
            adults: 2,
            children: 0,
            infants: 0,
          },
        ],
      });
      expect(revision.amount?.amount).toBe('220');
      expect(revision.amount?.currency).toBe('USD');
      expect(revision.otaCommission?.amount).toBe('33');
      expect(revision.otaCommission?.currency).toBe('USD');
    });

    it('A1: una habitación sin room_type_id (no mapeada en Channex) se lee con roomTypeId vacío', async () => {
      const unmapped = aRevision();
      unmapped.attributes.rooms[0].room_type_id = null as unknown as string;
      server.use(
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
          HttpResponse.json(feed([unmapped])),
        ),
      );

      const { revisions } = await newAdapter().fetchBookingFeed(1);

      expect(revisions[0].rooms[0].roomTypeId).toBeNull();
    });

    it('A1: sin titular ni notas, esos datos quedan vacíos', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
          HttpResponse.json(
            feed([aRevision({ customer: null, notes: '', amount: null })]),
          ),
        ),
      );

      const [revision] = (await newAdapter().fetchBookingFeed(1)).revisions;

      expect(revision.customer).toEqual({
        name: null,
        surname: null,
        mail: null,
        phone: null,
        country: null,
      });
      expect(revision.notes).toBeNull();
      expect(revision.amount).toBeNull();
    });

    it('A1: sin children ni infants en la ocupación, quedan en 0', async () => {
      const onlyAdults = aRevision();
      onlyAdults.attributes.rooms[0].occupancy = { adults: 2 } as never;
      server.use(
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
          HttpResponse.json(feed([onlyAdults])),
        ),
      );

      const [revision] = (await newAdapter().fetchBookingFeed(1)).revisions;

      expect(revision.rooms[0]).toMatchObject({
        adults: 2,
        children: 0,
        infants: 0,
      });
    });

    it.each([
      [
        'un importe de más de dos decimales',
        { amount: '220.005' },
        (revision: BookingRevision) => expect(revision.amount).toBeNull(),
      ],
      [
        'una moneda inválida',
        { currency: 'dólares' },
        (revision: BookingRevision) => {
          expect(revision.amount).toBeNull();
          expect(revision.otaCommission).toBeNull();
        },
      ],
      [
        'sin ota_commission',
        { ota_commission: undefined },
        (revision: BookingRevision) => {
          expect(revision.otaCommission).toBeNull();
          expect(revision.amount?.amount).toBe('220');
        },
      ],
      [
        'una comisión de más de dos decimales',
        { ota_commission: '33.005' },
        (revision: BookingRevision) =>
          expect(revision.otaCommission).toBeNull(),
      ],
      [
        'sin rooms',
        { rooms: undefined },
        (revision: BookingRevision) => expect(revision.rooms).toEqual([]),
      ],
      [
        'una habitación sin ocupación',
        {
          rooms: [{ checkin_date: '2026-11-10', checkout_date: '2026-11-12' }],
        },
        (revision: BookingRevision) =>
          expect(revision.rooms[0]).toMatchObject({
            adults: null,
            children: 0,
            infants: 0,
          }),
      ],
      [
        'una cantidad de personas que no es un entero',
        {
          rooms: [
            {
              checkin_date: '2026-11-10',
              checkout_date: '2026-11-12',
              occupancy: { adults: 'dos', children: -1, infants: 0 },
            },
          ],
        },
        (revision: BookingRevision) =>
          expect(revision.rooms[0]).toMatchObject({
            adults: null,
            children: null,
            infants: 0,
          }),
      ],
    ])(
      'A1: una revisión con %s se lee igual, con ese dato vacío (lo decide el caso de uso)',
      async (_, attributes, check) => {
        server.use(
          http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
            HttpResponse.json(feed([aRevision(attributes)])),
          ),
        );

        const { revisions } = await newAdapter().fetchBookingFeed(1);

        expect(revisions).toHaveLength(1);
        check(revisions[0]);
      },
    );

    it.each([
      ['sin id', { id: undefined }],
      ['sin booking_id', { booking_id: '' }],
      ['con un status desconocido', { status: 'requested' }],
      ['con una fecha de llegada inválida', { arrival_date: '2026-02-30' }],
      ['sin fecha de salida', { departure_date: undefined }],
      [
        'con una habitación con una fecha inválida',
        {
          rooms: [
            {
              checkin_date: '2026-11-10',
              checkout_date: '12/11/2026',
              occupancy: { adults: 2 },
            },
          ],
        },
      ],
    ])(
      'A1: una revisión %s se omite, se registra sin datos personales y las demás se leen',
      async (_, attributes) => {
        server.use(
          http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
            HttpResponse.json(
              feed([
                aRevision(attributes),
                aRevision({ id: 'b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e' }),
              ]),
            ),
          ),
        );
        const adapter = newAdapter();
        const logger = vi.spyOn(
          (adapter as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        );
        logger.mockImplementation(() => undefined);

        const page = await adapter.fetchBookingFeed(1);

        expect(page.revisions.map((revision) => revision.id)).toEqual([
          'b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e',
        ]);
        expect(page.total).toBe(2);
        expect(logger).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(logger.mock.calls);
        expect(logged).not.toContain('Ana');
        expect(logged).not.toContain('ana@correo.com');
      },
    );

    it('A1: un feed sin meta.total es ChannexUnavailableError', async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () =>
          HttpResponse.json({ data: [] }),
        ),
      );

      await expect(newAdapter().fetchBookingFeed(1)).rejects.toBeInstanceOf(
        ChannexUnavailableError,
      );
    });

    it.each([
      ['un 200 sin cuerpo', () => new HttpResponse(null, { status: 200 })],
      ['un 204', () => new HttpResponse(null, { status: 204 })],
      ['un 200 que no es JSON', () => new HttpResponse('OK', { status: 200 })],
    ])(
      'A3 de configure-ota y A2 y A3: %s basta, porque no se lee el cuerpo',
      async (_, reply) => {
        server.use(
          http.put(`${BASE_URL}/api/v1/room_types/${ROOM_TYPE_ID}`, reply),
          http.post(
            `${BASE_URL}/api/v1/booking_revisions/${REVISION_ID}/ack`,
            reply,
          ),
          http.post(`${BASE_URL}/api/v1/bookings/${BOOKING_ID}/no_show`, reply),
        );
        const adapter = newAdapter();

        await expect(
          adapter.updateRoomType(ROOM_TYPE_ID, {
            title: 'DOBLE',
            countOfRooms: 3,
            occupancy: 2,
          }),
        ).resolves.toBeUndefined();
        await expect(
          adapter.ackBookingRevision(REVISION_ID),
        ).resolves.toBeUndefined();
        await expect(adapter.reportNoShow(BOOKING_ID)).resolves.toBeUndefined();
      },
    );

    it('A2: confirma la revisión por su id', async () => {
      let called = false;
      server.use(
        http.post(
          `${BASE_URL}/api/v1/booking_revisions/${REVISION_ID}/ack`,
          () => {
            called = true;
            return HttpResponse.json({ meta: { message: 'Success' } });
          },
        ),
      );

      await newAdapter().ackBookingRevision(REVISION_ID);

      expect(called).toBe(true);
    });

    it('A3: reporta el no-show sin penalidad', async () => {
      let sent: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/api/v1/bookings/${BOOKING_ID}/no_show`,
          async ({ request }) => {
            sent = await request.json();
            return HttpResponse.json({ meta: { message: 'Success' } });
          },
        ),
      );

      await newAdapter().reportNoShow(BOOKING_ID);

      expect(sent).toEqual({ no_show_report: { waived_fees: true } });
    });

    it.each([
      [404, 'resource_not_found', 'Resource Not Found'],
      [422, 'method_not_supported', 'Method Not Supported'],
    ])(
      'A3: un %s %s es ChannexRejectedError con su código',
      async (status, code, title) => {
        server.use(
          http.post(`${BASE_URL}/api/v1/bookings/${BOOKING_ID}/no_show`, () =>
            HttpResponse.json(channexError(code, title), { status }),
          ),
        );

        await expect(newAdapter().reportNoShow(BOOKING_ID)).rejects.toEqual(
          new ChannexRejectedError(status, code),
        );
      },
    );
  });

  describe('respuestas de error', () => {
    const ackUrl = `${BASE_URL}/api/v1/booking_revisions/${REVISION_ID}/ack`;
    const ack = (adapter = newAdapter()) =>
      adapter.ackBookingRevision(REVISION_ID);

    it.each([401, 403])('un %s es ChannexUnauthorizedError', async (status) => {
      server.use(
        http.post(ackUrl, () =>
          HttpResponse.json(channexError('unauthorized', 'Unauthorized'), {
            status,
          }),
        ),
      );

      await expect(ack()).rejects.toEqual(new ChannexUnauthorizedError(status));
    });

    it('un 429 es ChannexRateLimitedError y las llamadas siguientes no salen a Channex', async () => {
      let calls = 0;
      server.use(
        http.post(ackUrl, () => {
          calls++;
          return HttpResponse.json(
            channexError('http_too_many_requests', 'Too Many Requests'),
            { status: 429 },
          );
        }),
        http.get(`${BASE_URL}/api/v1/booking_revisions/feed`, () => {
          calls++;
          return HttpResponse.json(feed([]));
        }),
      );
      const adapter = newAdapter();

      await expect(ack(adapter)).rejects.toBeInstanceOf(
        ChannexRateLimitedError,
      );
      await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
        ChannexRateLimitedError,
      );

      expect(calls).toBe(1);
    });

    describe('la pausa ante 429', () => {
      const MINUTE = 60_000;
      const feedUrl = `${BASE_URL}/api/v1/booking_revisions/feed`;
      let replies: number[];

      // Solo se finge la hora: msw y axios siguen con sus temporizadores reales.
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
        replies = [];
        server.use(
          http.get(feedUrl, () => {
            const status = replies.shift() ?? 200;
            return status === 429
              ? HttpResponse.json(
                  channexError('http_too_many_requests', 'Too Many Requests'),
                  { status },
                )
              : HttpResponse.json(feed([]));
          }),
        );
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      const advance = (ms: number) =>
        vi.setSystemTime(new Date(Date.now() + ms));

      it('dos 429 seguidos: la segunda pausa es de 2 minutos', async () => {
        const adapter = newAdapter();
        replies = [429, 429];

        await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
          ChannexRateLimitedError,
        );
        advance(MINUTE);
        await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
          ChannexRateLimitedError,
        );

        advance(2 * MINUTE - 1);
        await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
          ChannexRateLimitedError,
        );
        advance(1);
        await expect(adapter.fetchBookingFeed(1)).resolves.toMatchObject({
          total: 0,
        });
      });

      it('una respuesta buena en medio vuelve la siguiente pausa a 1 minuto', async () => {
        const adapter = newAdapter();
        replies = [429, 200, 429];

        await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
          ChannexRateLimitedError,
        );
        advance(MINUTE);
        await expect(adapter.fetchBookingFeed(1)).resolves.toMatchObject({
          total: 0,
        });
        await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
          ChannexRateLimitedError,
        );

        advance(MINUTE - 1);
        await expect(adapter.fetchBookingFeed(1)).rejects.toBeInstanceOf(
          ChannexRateLimitedError,
        );
        advance(1);
        await expect(adapter.fetchBookingFeed(1)).resolves.toMatchObject({
          total: 0,
        });
      });
    });

    it.each([500, 503, 302])(
      'un %s es ChannexUnavailableError',
      async (status) => {
        server.use(http.post(ackUrl, () => new HttpResponse(null, { status })));

        await expect(ack()).rejects.toBeInstanceOf(ChannexUnavailableError);
      },
    );

    it('una respuesta que no es JSON, donde se lee el cuerpo, es ChannexUnavailableError', async () => {
      server.use(
        http.get(
          `${BASE_URL}/api/v1/booking_revisions/feed`,
          () => new HttpResponse('<html>'),
        ),
      );

      await expect(newAdapter().fetchBookingFeed(1)).rejects.toBeInstanceOf(
        ChannexUnavailableError,
      );
    });

    it('si no responde en el tiempo máximo es ChannexUnavailableError', async () => {
      server.use(
        http.post(ackUrl, async () => {
          await delay(TIMEOUT_MS * 3);
          return HttpResponse.json({ meta: { message: 'Success' } });
        }),
      );

      await expect(ack()).rejects.toThrow('tiempo de espera agotado');
    });

    it('sin conexión es ChannexUnavailableError', async () => {
      server.use(http.post(ackUrl, () => HttpResponse.error()));

      await expect(ack()).rejects.toBeInstanceOf(ChannexUnavailableError);
    });

    it.each(['CHANNEX_BASE_URL', 'CHANNEX_API_KEY', 'CHANNEX_PROPERTY_ID'])(
      'sin %s falla con ChannexUnavailableError sin llamar a Channex',
      async (missing) => {
        // Sin manejadores: msw falla la prueba si sale alguna solicitud.
        await expect(
          ack(newAdapter({ ...SETTINGS, [missing]: '  ' })),
        ).rejects.toThrow(
          new ChannexUnavailableError('configuración incompleta'),
        );
      },
    );

    it('la clave nunca sale en el mensaje de un error', async () => {
      server.use(
        http.post(ackUrl, () =>
          HttpResponse.json(channexError('unauthorized', 'Unauthorized'), {
            status: 401,
          }),
        ),
      );

      const error: unknown = await ack().catch((caught: unknown) => caught);

      expect(String(error)).not.toContain(API_KEY);
      expect(JSON.stringify(error)).not.toContain(API_KEY);
    });
  });
});
