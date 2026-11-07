import { http, HttpResponse } from 'msw';
import { BizError, applyModification, cancel, previewModification } from './updateLogic';

const fail = (code: string, message: string, path: string) =>
  HttpResponse.json({ errorCode: code, message, timestamp: new Date().toISOString(), path }, { status: 400 });

// Todas las rutas son de la Recepcionista (X-Client: RECEPTIONIST). Los errores de negocio salen como 400.
const run = async (request: Request, body: () => Promise<Response> | Response) => {
  const path = new URL(request.url).pathname;
  if (request.headers.get('X-Client') !== 'RECEPTIONIST') return fail('INVALID_CLIENT', 'Cliente no válido.', path);
  try { return await body(); } catch (e) { if (e instanceof BizError) return fail(e.code, e.message, path); throw e; }
};

export const updateHandlers = [
  http.post('/api/reservations/:ref/modification-preview', ({ request, params }) =>
    run(request, async () => HttpResponse.json(previewModification(String(params.ref), await request.json() as never)))),
  http.patch('/api/reservations/:ref', ({ request, params }) =>
    run(request, async () => HttpResponse.json(applyModification(String(params.ref), await request.json() as never)))),
  http.post('/api/reservations/:ref/cancellation', ({ request, params }) =>
    run(request, async () => HttpResponse.json(cancel(String(params.ref), await request.json() as never, decodeURIComponent(request.headers.get('X-User') ?? ''))))),
];
