import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROOMS, NIGHTLY_RATES_IN_CENTS } from '../src/data.js';
import { GUESTS, RESERVATIONS, seed, todayInBogota } from '../src/seed.js';

/** Un Módulo 2 simulado: responde lo justo para que el seed avance y anota cada llamada. */
function fakeBackend({ existing = 0 } = {}) {
  /** @type {{ method: string; url: string; body: any }[]} */
  const calls = [];
  let next = 0;
  /** @type {typeof fetch} */
  const request = async (url, init = {}) => {
    const body = init.body === undefined ? null : JSON.parse(String(init.body));
    const method = init.method ?? 'GET';
    calls.push({ method, url: String(url), body });
    const reply = (value) =>
      new Response(JSON.stringify(value), { status: 200 });
    const path = new URL(String(url)).pathname;
    if (path === '/api/reservations') return reply({ totalItems: existing });
    if (path === '/api/reservations/direct/preview') {
      return reply({
        quotes: {
          rooms: body.rooms.map(() => ({
            lodgingAmount: { amount: '100.00', currency: 'COP' },
          })),
        },
      });
    }
    if (path === '/api/reservations/direct') {
      next += 1;
      return reply({
        reservationRef: `RSV-${String(next).padStart(8, '0')}`,
        updatedAt: 'x',
        rooms: body.rooms.map((room) => ({
          roomId: ROOMS[0].id,
          guestCount: room.guestCount,
        })),
      });
    }
    if (path.endsWith('/modification-preview')) return reply({ quotes: null });
    if (method === 'GET')
      return reply({ updatedAt: 'x', endDate: '2036-01-02' });
    return new Response('', { status: 200 });
  };
  return { calls, request };
}

const OPTIONS = {
  backendUrl: 'http://m2',
  module1Url: 'http://m1',
  today: '2036-01-01',
  log: () => {},
};

describe('Reservas de demo (seed)', () => {
  it('con reservas en el Módulo 2 no crea nada', async () => {
    const backend = fakeBackend({ existing: 3 });

    const result = await seed({ ...OPTIONS, request: backend.request });

    assert.equal(result.skipped, true);
    assert.deepEqual(
      backend.calls.map((call) => call.method),
      ['GET'],
    );
  });

  it('sobre una base vacía crea cada reserva con su Idempotency-Key, y modifica, cancela y hace el Check-In', async () => {
    const backend = fakeBackend();

    const result = await seed({ ...OPTIONS, request: backend.request });

    const count = (then) =>
      RESERVATIONS.filter((plan) => plan.then === then).length;
    assert.deepEqual(result, {
      skipped: false,
      created: RESERVATIONS.length,
      modified: count('MODIFY'),
      cancelled: count('CANCEL'),
      checkedIn: count('CHECK_IN'),
      failed: 0,
    });
    const created = backend.calls.filter(
      (call) => call.url === 'http://m2/api/reservations/direct',
    );
    assert.equal(created[0].body.expectedRates[0].lodgingAmount, '100.00');
    assert.equal(created[0].body.guest.birthDate, undefined);
    const checkIns = backend.calls.filter(
      (call) => call.url === 'http://m1/simulate/check-in',
    );
    assert.ok(checkIns.length >= count('CHECK_IN'));
    assert.equal(checkIns[0].body.guests.length, RESERVATIONS[0].rooms[0]);
  });

  it('las reservas usan solo categorías con habitaciones y tarifa, y titulares que existen y caben en cualquier habitación de su categoría', () => {
    const categories = new Set(ROOMS.map((room) => room.categoryRoom));
    for (const plan of RESERVATIONS) {
      assert.ok(categories.has(plan.categoryRoom), plan.categoryRoom);
      assert.ok(
        NIGHTLY_RATES_IN_CENTS.has(plan.categoryRoom),
        plan.categoryRoom,
      );
      assert.ok(GUESTS[plan.guest] !== undefined);
      assert.ok(plan.offset >= 0 && plan.offset <= 60);
      const capacity = Math.min(
        ...ROOMS.filter((room) => room.categoryRoom === plan.categoryRoom).map(
          (room) => room.maxCapacity,
        ),
      );
      assert.ok(
        plan.rooms.every((guests) => guests <= capacity),
        `${plan.categoryRoom} ${plan.rooms}`,
      );
    }
  });

  it('hoy es el día de America/Bogota', () => {
    assert.equal(todayInBogota(new Date('2036-01-02T03:00:00Z')), '2036-01-01');
  });
});
