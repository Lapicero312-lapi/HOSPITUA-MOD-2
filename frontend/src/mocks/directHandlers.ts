import { http, HttpResponse } from 'msw';
import type { DirectCreateRequest, DirectPreviewRequest, ReservationDetail } from '../types';
import { MAINTENANCE, OPERATIONAL_DATE, RATES, RESERVATIONS, ROOMS } from './data';

// Réplica de specs/generate-direct-reservation/plan.md (A, B y E) y de consult-room-inventory (C1).
const fail = (errorCode: string, message: string, path: string) =>
  HttpResponse.json({ errorCode, message, timestamp: new Date().toISOString(), path }, { status: 400 });
const noClient = (req: Request) => req.headers.get('X-Client') !== 'RECEPTIONIST';
const badClient = (req: Request) => fail('INVALID_CLIENT', 'Cliente no válido.', new URL(req.url).pathname);
class Fail extends Error { constructor(public code: string, message: string) { super(message); } }

const validDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;
const overlaps = (aS: string, aE: string, bS: string, bE: string) => aS < bE && aE > bS;
const money = (n: number) => ({ amount: n.toFixed(2), currency: 'COP' });
const days = (s: string, e: string) => Array.from({ length: (Date.parse(e) - Date.parse(s)) / 86_400_000 }, (_, i) => new Date(Date.parse(s) + i * 86_400_000).toISOString().slice(0, 10));

function preview(b: DirectPreviewRequest) {
  const rooms = Array.isArray(b?.rooms) ? b.rooms : [];
  if (rooms.length < 1 || rooms.length > 10) throw new Fail('INVALID_ROOM_COUNT', 'Una reserva debe tener entre 1 y 10 habitaciones.');
  for (const r of rooms) {
    if (!Number.isInteger(r.guestCount) || r.guestCount < 0) throw new Fail('INVALID_GUEST_COUNT', 'La cantidad de personas debe ser un número entero mayor que cero.');
    if (r.guestCount === 0) throw new Fail('GUEST_COUNT_TOO_LOW', 'Cada habitación debe tener al menos una persona.');
  }
  if (!validDate(b.startDate) || !validDate(b.endDate)) throw new Fail('INVALID_STAY_DATES', 'La fecha de salida debe ser posterior a la de entrada.');
  if (b.startDate < OPERATIONAL_DATE) throw new Fail('START_DATE_IN_PAST', 'La fecha de entrada no puede ser anterior a hoy.');
  if (b.endDate <= b.startDate) throw new Fail('INVALID_STAY_DATES', 'La fecha de salida debe ser posterior a la de entrada.');
  const inCategory = ROOMS.filter((r) => r.categoryRoom === b.categoryRoom);
  if (!inCategory.length) throw new Fail('INVALID_CATEGORY', 'La categoría de habitación no es válida.');

  const state = inCategory.map((room) => {
    const busy = RESERVATIONS.some((r) => ['ACTIVE', 'PENDING', 'IN_PROGRESS'].includes(r.status) && r.rooms.some((x) => x.roomNumber === room.roomNumber) && overlaps(r.startDate, r.endDate, b.startDate, b.endDate));
    const m = MAINTENANCE[room.roomNumber];
    const maint = !!m && overlaps(m.maintenanceStart, m.maintenanceEnd, b.startDate, b.endDate);
    return { roomId: room.id, roomNumber: room.roomNumber, available: !busy && !maint, reason: busy ? 'RESERVED' : maint ? 'MAINTENANCE' : null };
  });
  const free = state.filter((r) => r.available);
  if (free.length < rooms.length) throw new Fail('NO_AVAILABILITY', 'Error 400: La habitación no está disponible para el rango de fechas solicitado');

  const assignedRooms = rooms.map((r, i) => {
    const room = inCategory.find((x) => x.id === free[i].roomId)!;
    if (r.guestCount > room.maxCapacity) throw new Fail('GUEST_COUNT_EXCEEDS_CAPACITY', 'La cantidad de personas supera la capacidad de la habitación.');
    return { position: i + 1, roomId: room.id, roomNumber: room.roomNumber, maxCapacity: room.maxCapacity, guestCount: r.guestCount };
  });
  const rate = RATES[b.categoryRoom];
  const quoted = assignedRooms.map((a) => ({
    key: String(a.position), categoryRoom: b.categoryRoom, nights: days(b.startDate, b.endDate).length,
    nightlyRates: days(b.startDate, b.endDate).map((date) => ({ date, rate: money(rate) })), lodgingAmount: money(rate * days(b.startDate, b.endDate).length),
  }));
  return {
    availability: { startDate: b.startDate, endDate: b.endDate, categoryRoom: b.categoryRoom, availableCount: free.length, rooms: state },
    assignedRooms, quotes: { rooms: quoted, total: money(quoted.reduce((s, q) => s + Number(q.lodgingAmount.amount), 0)) },
    reservation: { guestCount: rooms.reduce((s, r) => s + r.guestCount, 0) },
  };
}

const sent = new Map<string, { body: string; ref: string }>(); // Idempotency-Key -> solicitud y reserva creada

export const directHandlers = [
  http.get('/api/rooms', ({ request }) => noClient(request) ? badClient(request) : HttpResponse.json({
    items: ROOMS.map((r) => ({ ...r, maintenance: MAINTENANCE[r.roomNumber] ? { status: 'SCHEDULED', ...MAINTENANCE[r.roomNumber] } : { status: 'NONE', maintenanceStart: null, maintenanceEnd: null } })),
    total: ROOMS.length,
  })),

  http.post('/api/reservations/direct/preview', async ({ request }) => {
    if (noClient(request)) return badClient(request);
    try { return HttpResponse.json(preview(await request.json() as DirectPreviewRequest)); }
    catch (e) { if (e instanceof Fail) return fail(e.code, e.message, '/api/reservations/direct/preview'); throw e; }
  }),

  http.post('/api/reservations/direct', async ({ request }) => {
    if (noClient(request)) return badClient(request);
    const path = '/api/reservations/direct';
    const key = request.headers.get('Idempotency-Key') ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return fail('IDEMPOTENCY_KEY_REQUIRED', 'Falta el identificador de la solicitud.', path);
    const raw = await request.text(); const b = JSON.parse(raw) as DirectCreateRequest;
    const prev = sent.get(key);
    if (prev) {
      if (prev.body !== raw) return fail('IDEMPOTENCY_KEY_REUSED', 'La solicitud ya se usó con otros datos.', path);
      return HttpResponse.json(RESERVATIONS.find((r) => r.reservationRef === prev.ref), { status: 201, headers: { Location: `/api/reservations/${prev.ref}` } });
    }
    try {
      const p = preview(b);
      if ((b.notes ?? '').length > 500) throw new Fail('NOTES_TOO_LONG', 'Las observaciones no pueden superar 500 caracteres.');
      if (!/^[\p{L}\d \n.,;:'"()¿?¡!@#%&+_/-]*$/u.test(b.notes ?? '')) throw new Fail('INVALID_CHARACTERS', 'El formato de los datos contiene caracteres no válidos.');
      const g = b.guest;
      if (!g || !g.firstName?.trim() || !g.lastName?.trim() || !g.documentType || !g.documentNumber?.trim() || !g.nationality?.trim()) throw new Fail('GUEST_DATA_REQUIRED', 'Los datos del titular son obligatorios.');
      if (!['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'].includes(g.documentType)) throw new Fail('INVALID_DOCUMENT_TYPE', 'El tipo de documento no es válido.');
      if (g.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.contactEmail)) throw new Fail('INVALID_EMAIL', 'El correo electrónico no es válido.');
      if (!/^[\p{L} '.-]+$/u.test(`${g.firstName}${g.lastName}${g.nationality}`.replace(/ /g, ' ')) ) throw new Fail('INVALID_CHARACTERS', 'El formato de los datos contiene caracteres no válidos.');
      const changed = p.quotes.rooms.some((q) => b.expectedRates?.find((e) => e.position === Number(q.key))?.lodgingAmount !== q.lodgingAmount.amount);
      if (changed) throw new Fail('RATE_CHANGED', 'La tarifa cambió, vuelva a cotizar.');

      const ref = `RSV-${Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, '0')}`;
      const created: ReservationDetail = {
        reservationRef: ref, status: 'ACTIVE', source: 'DIRECT', externalConfirmationCode: null, otaName: null,
        startDate: b.startDate, endDate: b.endDate, nights: p.quotes.rooms[0].nights, guestCount: p.reservation.guestCount, notes: b.notes ?? '',
        createdAt: `${OPERATIONAL_DATE}T${new Date().toTimeString().slice(0, 5)}:00-05:00`, updatedAt: new Date().toISOString().replace('Z', '000Z'), conflict: null,
        rooms: p.assignedRooms.map((a, i) => ({ roomId: a.roomId, roomNumber: a.roomNumber, categoryRoom: b.categoryRoom, guestCount: a.guestCount, roomGrossAmount: p.quotes.rooms[i].lodgingAmount, stayStatus: 'EXPECTED' as const })),
        guest: { firstName: g.firstName, lastName: g.lastName, documentType: g.documentType, documentNumber: g.documentNumber, nationality: g.nationality, contactPhone: g.contactPhone || null, contactEmail: g.contactEmail || null },
        cancellation: null,
      };
      RESERVATIONS.unshift(created); sent.set(key, { body: raw, ref });
      return HttpResponse.json(created, { status: 201, headers: { Location: `/api/reservations/${ref}` } });
    } catch (e) { if (e instanceof Fail) return fail(e.code, e.message, path); throw e; }
  }),

  http.get('/api/guests/lookup', ({ request }) => {
    if (noClient(request)) return badClient(request);
    const q = new URL(request.url).searchParams; const path = '/api/guests/lookup';
    const type = q.get('documentType'), num = q.get('documentNumber')?.trim();
    if (!type || !num) return fail('GUEST_DATA_REQUIRED', 'Los datos del titular son obligatorios.', path);
    if (!['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT'].includes(type)) return fail('INVALID_DOCUMENT_TYPE', 'El tipo de documento no es válido.', path);
    if (!/^[\p{L}\d-]+$/u.test(num)) return fail('INVALID_CHARACTERS', 'El formato de los datos contiene caracteres no válidos.', path);
    const last = RESERVATIONS.filter((r) => r.guest.documentType === type && r.guest.documentNumber === num).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return HttpResponse.json(last ? { found: true, guest: last.guest } : { found: false, guest: null });
  }),
];
