// @vitest-environment jsdom
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handlers } from './handlers';

(globalThis as { location?: unknown }).location = new URL('http://localhost/');
const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterAll(() => server.close());

const call = (method: string, path: string, body?: unknown) =>
  fetch(`http://localhost/api${path}`, {
    method,
    headers: {
      'X-Client': 'RECEPTIONIST',
      'X-User': encodeURIComponent('Laura Méndez'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const get = async (ref: string) =>
  (await call('GET', `/reservations/${ref}`)).json();
const code = async (res: Response) => (await res.json()).errorCode;
const REF = 'RSV-3F9A1C7B'; // directa, ACTIVE, Hab. 204 (Superior)

describe('modificar reserva (simulado)', () => {
  it('rechaza OTA, estados no editables y updatedAt viejo', async () => {
    expect(
      await code(
        await call('POST', '/reservations/RSV-A41F82D6/modification-preview', {
          updatedAt: 'x',
          notes: 'a',
        }),
      ),
    ).toBe('OTA_RESERVATION_READ_ONLY');
    expect(
      await code(
        await call('POST', '/reservations/RSV-C07A52F9/modification-preview', {
          updatedAt: 'x',
          notes: 'a',
        }),
      ),
    ).toBe('STATUS_NOT_EDITABLE');
    expect(
      await code(
        await call('POST', `/reservations/${REF}/modification-preview`, {
          updatedAt: 'viejo',
          notes: 'a',
        }),
      ),
    ).toBe('CONCURRENT_UPDATE');
  });
  it('solo notas: no recotiza (quotes null) y se guarda', async () => {
    const r = await get(REF);
    const p = await (
      await call('POST', `/reservations/${REF}/modification-preview`, {
        updatedAt: r.updatedAt,
        notes: 'Llegada tarde',
      })
    ).json();
    expect(p.quotes).toBeNull();
    expect(p.requiresConfirmation).toBe(false);
    expect(p.changes.notesChanged).toBe(true);
    const saved = await (
      await call('PATCH', `/reservations/${REF}`, {
        updatedAt: r.updatedAt,
        notes: 'Llegada tarde',
      })
    ).json();
    expect(saved.notes).toBe('Llegada tarde');
    expect(saved.updatedAt).not.toBe(r.updatedAt);
  });
  it('cambiar de categoría recotiza solo esa habitación; RATE_CHANGED si la tarifa vista no coincide', async () => {
    const r = await get(REF);
    const body = {
      updatedAt: r.updatedAt,
      rooms: [{ roomId: 'room-301', guestCount: 2 }],
    }; // Superior -> Suite
    const p = await (
      await call('POST', `/reservations/${REF}/modification-preview`, body)
    ).json();
    expect(p.quotes.rooms).toHaveLength(1);
    expect(p.requiresConfirmation).toBe(true);
    expect(
      await code(
        await call('PATCH', `/reservations/${REF}`, {
          ...body,
          expectedRates: [{ roomId: 'room-301', lodgingAmount: '1.00' }],
        }),
      ),
    ).toBe('RATE_CHANGED');
    const ok = await call('PATCH', `/reservations/${REF}`, {
      ...body,
      expectedRates: [
        {
          roomId: 'room-301',
          lodgingAmount: p.quotes.rooms[0].lodgingAmount.amount,
        },
      ],
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).rooms[0].categoryRoom).toBe('SUITE');
  });
  it('no deja quitar la última habitación ni cambiar la nacionalidad', async () => {
    const r = await get(REF);
    expect(
      await code(
        await call('POST', `/reservations/${REF}/modification-preview`, {
          updatedAt: r.updatedAt,
          rooms: [],
        }),
      ),
    ).toBe('LAST_ROOM_CANNOT_BE_REMOVED');
    expect(
      await code(
        await call('POST', `/reservations/${REF}/modification-preview`, {
          updatedAt: r.updatedAt,
          guest: { nationality: 'Perú' },
        }),
      ),
    ).toBe('NATIONALITY_NOT_EDITABLE');
  });
});

describe('cancelar reserva (simulado)', () => {
  const REF2 = 'RSV-5C19D3E8';
  it('exige casilla y updatedAt vigente, y guarda processedBy desde X-User', async () => {
    const r = await get(REF2);
    expect(
      await code(
        await call('POST', `/reservations/${REF2}/cancellation`, {
          updatedAt: r.updatedAt,
          acknowledged: false,
        }),
      ),
    ).toBe('CANCELLATION_NOT_CONFIRMED');
    expect(
      await code(
        await call('POST', `/reservations/${REF2}/cancellation`, {
          updatedAt: 'viejo',
          acknowledged: true,
        }),
      ),
    ).toBe('CONCURRENT_UPDATE');
    const res = await call('POST', `/reservations/${REF2}/cancellation`, {
      updatedAt: r.updatedAt,
      acknowledged: true,
      reason: 'Cambio de planes',
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.status).toBe('CANCELLED');
    expect(out.cancellation.processedBy).toBe('Laura Méndez');
    expect(out.cancellation.channel).toBe('RECEPTION');
    expect((await get(REF2)).cancellation.reason).toBe('Cambio de planes');
  });
  it('una segunda cancelación recibe el mensaje de concurrencia y las OTA no se cancelan aquí', async () => {
    const r = await get(REF2);
    expect(
      await code(
        await call('POST', `/reservations/${REF2}/cancellation`, {
          updatedAt: 'viejo',
          acknowledged: true,
        }),
      ),
    ).toBe('CONCURRENT_UPDATE');
    expect(
      await code(
        await call('POST', `/reservations/${REF2}/cancellation`, {
          updatedAt: r.updatedAt,
          acknowledged: true,
        }),
      ),
    ).toBe('STATUS_NOT_CANCELLABLE');
    expect(
      await code(
        await call('POST', '/reservations/RSV-A41F82D6/cancellation', {
          updatedAt: 'x',
          acknowledged: true,
        }),
      ),
    ).toBe('OTA_RESERVATION_CANCEL_VIA_API');
  });
});
