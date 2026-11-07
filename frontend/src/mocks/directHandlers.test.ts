// @vitest-environment node
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handlers } from './handlers';

// MSW en Node resuelve las rutas relativas contra `location`.
(globalThis as { location?: unknown }).location = new URL('http://localhost/');
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const H = { 'X-Client': 'RECEPTIONIST', 'Content-Type': 'application/json' };
const call = (path: string, body?: unknown, extra: Record<string, string> = {}) =>
  fetch(`http://localhost/api${path}`, { method: body ? 'POST' : 'GET', headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
const stay = { startDate: '2026-12-10', endDate: '2026-12-13', categoryRoom: 'SUPERIOR', rooms: [{ guestCount: 2 }, { guestCount: 3 }] };
const guest = { firstName: 'Ana', lastName: 'Pérez', documentType: 'CC', documentNumber: '555', nationality: 'Colombia' };

describe('reserva directa simulada (contrato del plan)', () => {
  it('rechaza sin X-Client', async () => {
    const r = await fetch('http://localhost/api/rooms');
    expect(r.status).toBe(400);
  });
  it('vista previa: asigna menor roomNumber, cotiza por habitación y suma el total', async () => {
    const p = await (await call('/reservations/direct/preview', stay)).json();
    expect(p.assignedRooms.map((a: { roomNumber: string }) => a.roomNumber)).toEqual(['201', '202']);
    expect(p.quotes.rooms).toHaveLength(2);
    expect(p.quotes.total.amount).toBe((Number(p.quotes.rooms[0].lodgingAmount.amount) * 2).toFixed(2));
  });
  it('errores 400 con el mensaje literal del spec', async () => {
    const past = await call('/reservations/direct/preview', { ...stay, startDate: '2026-10-01' });
    expect((await past.json()).errorCode).toBe('START_DATE_IN_PAST');
    const noRooms = await call('/reservations/direct/preview', { ...stay, rooms: Array(5).fill({ guestCount: 1 }) });
    expect((await noRooms.json()).errorCode).toBe('NO_AVAILABILITY');
  });
  it('crear: exige Idempotency-Key, vuelve a cotizar y es idempotente', async () => {
    const p = await (await call('/reservations/direct/preview', stay)).json();
    const body = { ...stay, guest, expectedRates: p.quotes.rooms.map((q: { key: string; lodgingAmount: { amount: string } }) => ({ position: Number(q.key), lodgingAmount: q.lodgingAmount.amount })) };
    expect((await (await call('/reservations/direct', body)).json()).errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = crypto.randomUUID();
    const a = await call('/reservations/direct', body, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    const ref = (await a.json()).reservationRef;
    expect(a.headers.get('Location')).toBe(`/api/reservations/${ref}`);
    expect((await (await call('/reservations/direct', body, { 'Idempotency-Key': key })).json()).reservationRef).toBe(ref);
    const reused = await call('/reservations/direct', { ...body, notes: 'otro' }, { 'Idempotency-Key': key });
    expect((await reused.json()).errorCode).toBe('IDEMPOTENCY_KEY_REUSED');
    const stale = await call('/reservations/direct', { ...body, expectedRates: [{ position: 1, lodgingAmount: '1.00' }, { position: 2, lodgingAmount: '1.00' }] }, { 'Idempotency-Key': crypto.randomUUID() });
    expect((await stale.json()).errorCode).toBe('RATE_CHANGED');
  });
  it('precarga el titular de la reserva más reciente y no falla si no existe', async () => {
    expect((await (await call('/guests/lookup?documentType=CC&documentNumber=1144093552')).json()).guest.firstName).toBe('Valentina');
    expect(await (await call('/guests/lookup?documentType=CC&documentNumber=000')).json()).toEqual({ found: false, guest: null });
  });
});
