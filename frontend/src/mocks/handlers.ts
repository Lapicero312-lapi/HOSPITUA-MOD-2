import { http, HttpResponse } from 'msw';
import type { ReservationDetail, ReservationListItem } from '../types';
import { OPERATIONAL_DATE, OTAS, RESERVATIONS } from './data';
import { directHandlers } from './directHandlers';
import { updateHandlers } from './updateHandlers';

// Réplica del contrato de specs/check-view-reservation/plan.md. Orden de validación: search -> status -> source
// -> fechas -> order -> page -> longitud del nombre.
const STATUSES = [
  'PENDING',
  'ACTIVE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const fail = (errorCode: string, message: string, path: string) =>
  HttpResponse.json(
    { errorCode, message, timestamp: new Date().toISOString(), path },
    { status: 400 },
  );
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0, 10) === s;

function toItem(r: ReservationDetail): ReservationListItem {
  const editable =
    r.source === 'DIRECT' && (r.status === 'ACTIVE' || r.status === 'PENDING');
  const foreign = r.guest.nationality !== 'Colombia';
  const migrationStatus =
    r.status === 'ACTIVE' || r.status === 'PENDING'
      ? 'AWAITING_CHECK_IN'
      : r.status === 'CANCELLED' || r.status === 'NO_SHOW'
        ? 'NO_CHECK_IN'
        : foreign
          ? 'COMPLETE'
          : 'NOT_REQUIRED';
  return {
    reservationRef: r.reservationRef,
    externalConfirmationCode: r.externalConfirmationCode,
    guest: {
      fullName: `${r.guest.firstName} ${r.guest.lastName}`,
      documentNumber: r.guest.documentNumber,
    },
    rooms: r.rooms.map(({ roomNumber, categoryRoom }) => ({
      roomNumber,
      categoryRoom,
    })),
    source: r.source,
    otaName: r.otaName,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
    migrationStatus,
    conflict: r.conflict,
    actions: {
      canModify: editable,
      canCancel: editable,
      canAssignRoom: !!r.conflict && r.rooms.some((x) => !x.roomNumber),
    },
  };
}

const checkClient = (req: Request) =>
  req.headers.get('X-Client') === 'RECEPTIONIST';

export const handlers = [
  ...directHandlers,
  ...updateHandlers,
  http.get('/api/otas', () => HttpResponse.json(OTAS)),

  http.get('/api/reservations/day-summary', ({ request }) => {
    if (!checkClient(request))
      return fail(
        'INVALID_CLIENT',
        'Cliente no válido.',
        '/api/reservations/day-summary',
      );
    return HttpResponse.json({
      operationalDate: OPERATIONAL_DATE,
      expectedArrivals: RESERVATIONS.filter(
        (r) =>
          ['ACTIVE', 'PENDING'].includes(r.status) &&
          r.startDate === OPERATIONAL_DATE,
      ).length,
      expectedDepartures: RESERVATIONS.filter(
        (r) => r.status === 'IN_PROGRESS' && r.endDate === OPERATIONAL_DATE,
      ).length,
    });
  }),

  http.get('/api/reservations/:ref', ({ request, params }) => {
    const path = new URL(request.url).pathname;
    if (!checkClient(request))
      return fail('INVALID_CLIENT', 'Cliente no válido.', path);
    const ref = String(params.ref);
    if (!/^[\p{L}\d-]{1,40}$/u.test(ref))
      return fail(
        'INVALID_RESERVATION_CODE',
        'Debe proveer un código de reserva válido para la consulta.',
        path,
      );
    const found = RESERVATIONS.find(
      (r) => r.reservationRef.toLowerCase() === ref.toLowerCase(),
    );
    return found
      ? HttpResponse.json(found)
      : fail('RESERVATION_NOT_FOUND', 'La reserva no existe.', path);
  }),

  http.get('/api/reservations', ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const q = url.searchParams;
    if (!checkClient(request))
      return fail('INVALID_CLIENT', 'Cliente no válido.', path);

    let search = q.get('search');
    if (search !== null) {
      search = search.trim().replace(/\s+/g, ' ');
      if (!search || search.length > 40 || !/^[\p{L}\d -]+$/u.test(search))
        return fail(
          'INVALID_RESERVATION_CODE',
          'Debe proveer un código de reserva válido para la consulta.',
          path,
        );
    }
    const status = q.get('status'),
      source = q.get('source'),
      otaId = q.get('otaId');
    if (status && !STATUSES.includes(status))
      return fail('INVALID_STATUS', 'El estado indicado no es válido.', path);
    if (source && !['DIRECT', 'OTA'].includes(source))
      return fail('INVALID_CHANNEL', 'El canal indicado no es válido.', path);
    if (otaId && source !== 'OTA')
      return fail(
        'AGENCY_REQUIRES_OTA_CHANNEL',
        'La agencia solo aplica a reservas del canal OTA.',
        path,
      );
    const from = q.get('dateFrom'),
      to = q.get('dateTo');
    if ((from && !validDate(from)) || (to && !validDate(to)))
      return fail('INVALID_DATE', 'La fecha indicada no es válida.', path);
    if (!!from !== !!to)
      return fail(
        'INCOMPLETE_DATE_RANGE',
        'Debe completar ambas fechas del rango.',
        path,
      );
    if (from && to) {
      if (from > to)
        return fail(
          'INVALID_DATE_RANGE',
          'La fecha inicial no puede ser posterior a la fecha final.',
          path,
        );
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 366)
        return fail(
          'DATE_RANGE_TOO_LARGE',
          'El rango de fechas no puede superar 366 días.',
          path,
        );
    }
    const order = q.get('order') ?? 'desc';
    if (!['asc', 'desc'].includes(order))
      return fail(
        'INVALID_SORT_ORDER',
        'El orden indicado no es válido.',
        path,
      );
    const pageParam = q.get('page') ?? '1';
    if (!/^\d+$/.test(pageParam) || Number(pageParam) < 1)
      return fail(
        'INVALID_PAGE',
        'El número de página debe ser 1 o mayor.',
        path,
      );

    let rows = RESERVATIONS;
    const filters = (r: ReservationDetail) =>
      (!status || r.status === status) &&
      (!source || r.source === source) &&
      (!otaId || r.otaName === OTAS.find((o) => o.id === otaId)?.name) &&
      (q.get('inConflict') !== 'true' || !!r.conflict) &&
      (!from || !to || (r.startDate <= to && r.endDate > from));

    if (search) {
      const code = RESERVATIONS.filter((r) =>
        [r.reservationRef, r.externalConfirmationCode].some(
          (c) => c?.toLowerCase() === search!.toLowerCase(),
        ),
      );
      if (code.length)
        rows = code; // el código ignora los demás filtros
      else if (/^rsv-/i.test(search))
        return fail('RESERVATION_NOT_FOUND', 'La reserva no existe.', path);
      else if (/\d/.test(search))
        rows = RESERVATIONS.filter(
          (r) => r.guest.documentNumber === search && filters(r),
        );
      else {
        if (search.length < 3)
          return fail(
            'NAME_SEARCH_TOO_SHORT',
            'La búsqueda por nombre requiere al menos 3 caracteres.',
            path,
          );
        rows = RESERVATIONS.filter(
          (r) =>
            norm(`${r.guest.firstName} ${r.guest.lastName}`).includes(
              norm(search!),
            ) && filters(r),
        );
      }
    } else rows = RESERVATIONS.filter(filters);

    rows = [...rows].sort(
      (a, b) =>
        (order === 'asc' ? 1 : -1) * a.startDate.localeCompare(b.startDate),
    );
    const totalPages = Math.ceil(rows.length / 10);
    const page = Math.min(Number(pageParam), Math.max(totalPages, 1)); // pasa de la última: devuelve la última
    return HttpResponse.json({
      items: rows.slice((page - 1) * 10, page * 10).map(toItem),
      page,
      pageSize: 10,
      totalItems: rows.length,
      totalPages,
      message: rows.length
        ? null
        : 'No se encontraron reservas con los filtros aplicados.',
    });
  }),
];
