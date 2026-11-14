import { randomUUID } from 'node:crypto';
import { addDays } from './dates.js';

/**
 * Reservas de demo (plan base, "Simuladores del Módulo 1 y del Módulo 3"): llena el Módulo 2 por sus rutas
 * REST, nunca escribiendo en su base, así que cada reserva pasa por todas sus reglas. Crea reservas
 * directas de hoy y de los próximos 60 días en todas las categorías, modifica algunas, cancela otras y hace
 * el Check-In de parte de las llegadas de hoy por `POST /simulate/check-in` del simulador del Módulo 1.
 *
 * Se corre sobre una base sin reservas: si ya hay alguna, avisa y no hace nada. Una reserva que el Módulo 2
 * rechaza (por ejemplo, sin disponibilidad) queda en el log y se sigue con las demás.
 *
 * Uso: `pnpm --filter simulators seed`, con `BACKEND_URL` (por defecto `http://localhost:3000`) y
 * `MODULE1_SIMULATOR_URL` (por defecto `http://localhost:4001`; en Render, la URL de los simuladores).
 */

/**
 * @typedef {{ firstName: string; lastName: string; documentType: string; documentNumber: string; nationality: string; contactPhone: string | null; contactEmail: string | null; birthDate: string; originPlace?: string; destinationPlace?: string }} DemoGuest
 * @typedef {{ offset: number; nights: number; categoryRoom: string; rooms: number[]; guest: number; notes?: string; then?: 'MODIFY' | 'CANCEL' | 'CHECK_IN' }} DemoReservation
 * @typedef {{ reservationRef: string; updatedAt: string; rooms: { roomId: string | null; guestCount: number }[] }} CreatedReservation
 */

/** @type {readonly DemoGuest[]} */
export const GUESTS = [
  guest('Ana', 'Pérez', 'CC', '1023456789', 'Colombia', '1995-03-20'),
  guest('Carlos', 'Rodríguez', 'CC', '79845123', 'Colombia', '1982-07-11'),
  guest('Laura', 'Gómez', 'CC', '1144093552', 'Colombia', '1998-01-30'),
  guest('Andrés', 'Martínez', 'CC', '80123987', 'Colombia', '1979-12-02'),
  guest('Valentina', 'Ospina', 'CC', '1020304050', 'Colombia', '2000-05-14'),
  guest('Juan', 'Castaño', 'CE', '456789', 'Venezuela', '1990-09-09'),
  guest(
    'John',
    'Smith',
    'PAS',
    'X9912345',
    'Estados Unidos',
    '1985-05-12',
    'Miami, Estados Unidos',
  ),
  guest(
    'Emily',
    'Johnson',
    'PAS',
    'Y5523981',
    'Estados Unidos',
    '1992-11-23',
    'Nueva York, Estados Unidos',
  ),
  guest(
    'Lucía',
    'Fernández',
    'PAS',
    'PAE123456',
    'España',
    '1988-04-04',
    'Madrid, España',
  ),
  guest(
    'Pierre',
    'Dubois',
    'PAS',
    '18FR45612',
    'Francia',
    '1976-02-17',
    'París, Francia',
  ),
  guest(
    'Hannah',
    'Müller',
    'PAS',
    'C01X00T47',
    'Alemania',
    '1994-08-29',
    'Berlín, Alemania',
  ),
  guest(
    'Sofía',
    'Hernández',
    'PAS',
    'G12345678',
    'México',
    '1997-06-06',
    'Ciudad de México, México',
  ),
  guest(
    'Mateo',
    'González',
    'PAS',
    'AAB123456',
    'Argentina',
    '1989-10-21',
    'Buenos Aires, Argentina',
  ),
  guest(
    'Giulia',
    'Rossi',
    'PAS',
    'YA1234567',
    'Italia',
    '1991-03-03',
    'Roma, Italia',
  ),
];

/**
 * Las reservas de la demo, por día de llegada (`offset` desde hoy). Cada habitación pide como mucho la menor
 * capacidad de su categoría: el Módulo 2 asigna la de menor número libre, que puede ser la más chica. Todas las categorías tienen llegadas
 * hoy, en los próximos días y más adelante; algunas se modifican, otras se cancelan y parte de las de hoy
 * hacen el Check-In.
 * @type {readonly DemoReservation[]}
 */
export const RESERVATIONS = [
  // Llegadas de hoy: la lista del día y el Check-In.
  {
    offset: 0,
    nights: 2,
    categoryRoom: 'DOBLE',
    rooms: [2],
    guest: 0,
    then: 'CHECK_IN',
  },
  {
    offset: 0,
    nights: 3,
    categoryRoom: 'INDIVIDUAL',
    rooms: [1],
    guest: 6,
    then: 'CHECK_IN',
  },
  {
    offset: 0,
    nights: 1,
    categoryRoom: 'TRIPLE',
    rooms: [3],
    guest: 9,
    then: 'CHECK_IN',
  },
  {
    offset: 0,
    nights: 4,
    categoryRoom: 'SUITE',
    rooms: [4],
    guest: 8,
    notes: 'Aniversario: decoración en la habitación',
  },
  { offset: 0, nights: 2, categoryRoom: 'SUITE_JUNIOR', rooms: [2], guest: 1 },
  {
    offset: 0,
    nights: 5,
    categoryRoom: 'INDIVIDUAL',
    rooms: [1],
    guest: 11,
    then: 'CHECK_IN',
  },
  // Esta semana.
  {
    offset: 1,
    nights: 2,
    categoryRoom: 'DOBLE',
    rooms: [2, 2],
    guest: 2,
    notes: 'Dos habitaciones juntas si es posible',
  },
  {
    offset: 1,
    nights: 1,
    categoryRoom: 'INDIVIDUAL',
    rooms: [1],
    guest: 3,
    then: 'CANCEL',
  },
  { offset: 2, nights: 3, categoryRoom: 'TRIPLE', rooms: [3], guest: 12 },
  {
    offset: 2,
    nights: 2,
    categoryRoom: 'SUITE',
    rooms: [4],
    guest: 10,
    then: 'MODIFY',
  },
  { offset: 3, nights: 4, categoryRoom: 'DOBLE', rooms: [2], guest: 4 },
  {
    offset: 3,
    nights: 2,
    categoryRoom: 'SUITE_JUNIOR',
    rooms: [2],
    guest: 13,
    notes: 'Llegada tarde, después de las 22:00',
  },
  { offset: 4, nights: 1, categoryRoom: 'INDIVIDUAL', rooms: [1], guest: 5 },
  {
    offset: 5,
    nights: 3,
    categoryRoom: 'DOBLE',
    rooms: [1],
    guest: 7,
    then: 'MODIFY',
  },
  {
    offset: 6,
    nights: 2,
    categoryRoom: 'TRIPLE',
    rooms: [3, 3],
    guest: 0,
    notes: 'Grupo familiar',
  },
  // Las próximas semanas.
  { offset: 8, nights: 5, categoryRoom: 'SUITE', rooms: [4], guest: 9 },
  {
    offset: 9,
    nights: 2,
    categoryRoom: 'DOBLE',
    rooms: [2],
    guest: 1,
    then: 'CANCEL',
  },
  {
    offset: 10,
    nights: 3,
    categoryRoom: 'INDIVIDUAL',
    rooms: [1, 1],
    guest: 2,
  },
  {
    offset: 12,
    nights: 7,
    categoryRoom: 'SUITE_JUNIOR',
    rooms: [2],
    guest: 8,
    notes: 'Luna de miel',
  },
  {
    offset: 14,
    nights: 2,
    categoryRoom: 'TRIPLE',
    rooms: [3],
    guest: 3,
    then: 'MODIFY',
  },
  {
    offset: 15,
    nights: 4,
    categoryRoom: 'DOBLE',
    rooms: [2, 2, 2],
    guest: 11,
    notes: 'Grupo de un congreso',
  },
  { offset: 18, nights: 2, categoryRoom: 'SUITE', rooms: [4], guest: 4 },
  {
    offset: 20,
    nights: 3,
    categoryRoom: 'INDIVIDUAL',
    rooms: [1],
    guest: 12,
    then: 'CANCEL',
  },
  { offset: 22, nights: 2, categoryRoom: 'DOBLE', rooms: [2], guest: 5 },
  { offset: 25, nights: 6, categoryRoom: 'TRIPLE', rooms: [3], guest: 6 },
  {
    offset: 28,
    nights: 3,
    categoryRoom: 'SUITE_JUNIOR',
    rooms: [2],
    guest: 10,
    then: 'MODIFY',
  },
  // Más adelante.
  { offset: 32, nights: 4, categoryRoom: 'DOBLE', rooms: [2], guest: 13 },
  { offset: 35, nights: 2, categoryRoom: 'SUITE', rooms: [4], guest: 7 },
  { offset: 38, nights: 3, categoryRoom: 'INDIVIDUAL', rooms: [1], guest: 0 },
  {
    offset: 42,
    nights: 5,
    categoryRoom: 'TRIPLE',
    rooms: [3, 3],
    guest: 9,
    then: 'CANCEL',
  },
  { offset: 45, nights: 2, categoryRoom: 'DOBLE', rooms: [2], guest: 2 },
  {
    offset: 48,
    nights: 3,
    categoryRoom: 'SUITE_JUNIOR',
    rooms: [2],
    guest: 11,
  },
  { offset: 52, nights: 4, categoryRoom: 'SUITE', rooms: [4], guest: 1 },
  { offset: 55, nights: 2, categoryRoom: 'DOBLE', rooms: [1], guest: 8 },
  { offset: 58, nights: 3, categoryRoom: 'INDIVIDUAL', rooms: [1], guest: 4 },
  { offset: 60, nights: 2, categoryRoom: 'TRIPLE', rooms: [3], guest: 12 },
];

/**
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} documentType
 * @param {string} documentNumber
 * @param {string} nationality
 * @param {string} birthDate
 * @param {string} [originPlace] solo extranjeros (SIRE)
 * @returns {DemoGuest}
 */
function guest(
  firstName,
  lastName,
  documentType,
  documentNumber,
  nationality,
  birthDate,
  originPlace,
) {
  const email = `${firstName}.${lastName}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return {
    firstName,
    lastName,
    documentType,
    documentNumber,
    nationality,
    contactPhone: nationality === 'Colombia' ? '+57 300 555 0101' : null,
    contactEmail: `${email}@correo.com`,
    birthDate,
    ...(originPlace === undefined
      ? {}
      : { originPlace, destinationPlace: 'Cartagena, Colombia' }),
  };
}

/** Hoy en America/Bogota, la zona del hotel, como `AAAA-MM-DD`. */
export function todayInBogota(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
  }).format(now);
}

/** Un error del Módulo 2, con su `errorCode`. */
class BackendError extends Error {
  /** @param {string} what @param {number} status @param {any} body */
  constructor(what, status, body) {
    super(
      `${what}: ${status} ${body?.errorCode ?? ''} ${body?.message ?? ''}`.trim(),
    );
    this.errorCode = body?.errorCode;
  }
}

/**
 * Llena el Módulo 2. Devuelve lo que hizo, para el resumen.
 * @param {{ backendUrl: string; module1Url: string; today: string; log?: (line: string) => void; request?: typeof fetch }} options
 */
export async function seed({
  backendUrl,
  module1Url,
  today,
  log = console.log,
  request = fetch,
}) {
  /** @param {string} url @param {string} what @param {RequestInit & { json?: unknown }} [init] */
  const call = async (url, what, init = {}) => {
    const { json, headers, ...rest } = init;
    const response = await request(url, {
      ...rest,
      // Como la pantalla de la Recepcionista: `X-Client` y el nombre de quien opera, para la auditoría.
      headers: {
        'Content-Type': 'application/json',
        'X-Client': 'RECEPTIONIST',
        'X-User': 'Demo',
        ...headers,
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
    const text = await response.text();
    const body = text === '' ? null : JSON.parse(text);
    if (!response.ok) {
      throw new BackendError(what, response.status, body);
    }
    return body;
  };
  /** @param {string} path @param {string} what @param {RequestInit & { json?: unknown }} [init] */
  const api = (path, what, init) => call(`${backendUrl}${path}`, what, init);

  const existing = await api('/api/reservations?page=1', 'Leer las reservas');
  if (existing.totalItems > 0) {
    log(
      `El Módulo 2 ya tiene ${existing.totalItems} reservas: no se crea nada. El seed se corre sobre una base sin reservas.`,
    );
    return {
      skipped: true,
      created: 0,
      modified: 0,
      cancelled: 0,
      checkedIn: 0,
      failed: 0,
    };
  }

  const summary = {
    skipped: false,
    created: 0,
    modified: 0,
    cancelled: 0,
    checkedIn: 0,
    failed: 0,
  };
  for (const plan of RESERVATIONS) {
    const label = `${plan.categoryRoom} del ${addDays(today, plan.offset)} (${plan.nights} noches)`;
    try {
      const created = await createDirect(api, plan, today);
      summary.created += 1;
      log(`Reserva ${created.reservationRef}: ${label}.`);
      if (plan.then === 'MODIFY') {
        await modify(api, created);
        summary.modified += 1;
        log(
          `  ${created.reservationRef} modificada: una noche más y sus observaciones.`,
        );
      } else if (plan.then === 'CANCEL') {
        await cancel(api, created);
        summary.cancelled += 1;
        log(`  ${created.reservationRef} cancelada.`);
      } else if (plan.then === 'CHECK_IN') {
        await checkIn(call, module1Url, created, GUESTS[plan.guest]);
        summary.checkedIn += 1;
        log(
          `  ${created.reservationRef}: Check-In enviado por el simulador del Módulo 1.`,
        );
      }
    } catch (error) {
      summary.failed += 1;
      log(
        `No se pudo con la reserva ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  log(
    `Listo: ${summary.created} reservas creadas, ${summary.modified} modificadas, ${summary.cancelled} canceladas, ${summary.checkedIn} con Check-In y ${summary.failed} que no se pudieron.`,
  );
  return summary;
}

/**
 * La vista previa (A) y la creación (B) de `generate-direct-reservation`, con las tarifas que dio la vista
 * previa, como la pantalla.
 * @returns {Promise<CreatedReservation>}
 */
async function createDirect(api, plan, today) {
  const request = {
    startDate: addDays(today, plan.offset),
    endDate: addDays(today, plan.offset + plan.nights),
    categoryRoom: plan.categoryRoom,
    rooms: plan.rooms.map((guestCount) => ({ guestCount })),
  };
  const preview = await api(
    '/api/reservations/direct/preview',
    'Vista previa',
    {
      method: 'POST',
      json: request,
    },
  );
  const {
    birthDate: _birthDate,
    originPlace: _origin,
    destinationPlace: _destination,
    ...holder
  } = GUESTS[plan.guest];
  return api('/api/reservations/direct', 'Crear la reserva', {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    json: {
      ...request,
      guest: holder,
      notes: plan.notes ?? null,
      expectedRates: preview.quotes.rooms.map((room, index) => ({
        position: index + 1,
        lodgingAmount: room.lodgingAmount.amount,
        currency: room.lodgingAmount.currency,
      })),
    },
  });
}

/** Una noche más y observaciones nuevas (B1 y B2 de `update-reservation`), con las tarifas de la vista previa. */
async function modify(api, created) {
  const ref = created.reservationRef;
  const current = await api(`/api/reservations/${ref}`, 'Leer la reserva');
  const change = {
    updatedAt: current.updatedAt,
    endDate: addDays(current.endDate, 1),
    notes: 'Modificada: el huésped pidió una noche más.',
  };
  const preview = await api(
    `/api/reservations/${ref}/modification-preview`,
    'Vista previa de la modificación',
    {
      method: 'POST',
      json: change,
    },
  );
  await api(`/api/reservations/${ref}`, 'Modificar la reserva', {
    method: 'PATCH',
    json: {
      ...change,
      expectedRates: (preview.quotes?.rooms ?? []).map((room) => ({
        roomId: room.key,
        lodgingAmount: room.lodgingAmount.amount,
        currency: room.lodgingAmount.currency,
      })),
    },
  });
}

/** La cancelación (A de `cancel-reservation`). */
async function cancel(api, created) {
  const ref = created.reservationRef;
  const current = await api(`/api/reservations/${ref}`, 'Leer la reserva');
  await api(`/api/reservations/${ref}/cancellation`, 'Cancelar la reserva', {
    method: 'POST',
    json: {
      updatedAt: current.updatedAt,
      acknowledged: true,
      reason: 'El huésped cambió de planes.',
    },
  });
}

/**
 * El Check-In de cada habitación por el simulador del Módulo 1, con tantos huéspedes como su `guestCount`:
 * el titular y acompañantes de la misma nacionalidad.
 */
async function checkIn(call, module1Url, created, holder) {
  for (const [index, room] of created.rooms.entries()) {
    if (room.roomId === null) {
      continue;
    }
    const guests = Array.from({ length: room.guestCount }, (_, position) => {
      const { contactPhone: _phone, contactEmail: _email, ...person } = holder;
      return position === 0 && index === 0
        ? person
        : {
            ...person,
            firstName: `Acompañante ${index + 1}.${position + 1}`,
            documentNumber: `${holder.documentNumber}${index}${position}`,
          };
    });
    await call(`${module1Url}/simulate/check-in`, 'Check-In', {
      method: 'POST',
      json: {
        reservationRef: created.reservationRef,
        roomId: room.roomId,
        guests,
      },
    });
  }
}

const isMain =
  import.meta.url ===
    new URL(`file://${process.argv[1]?.replace(/\\/g, '/')}`).href ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('/src/seed.js');
if (isMain) {
  const result = await seed({
    backendUrl: (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(
      /\/$/,
      '',
    ),
    module1Url: (
      process.env.MODULE1_SIMULATOR_URL ?? 'http://localhost:4001'
    ).replace(/\/$/, ''),
    today: todayInBogota(),
  });
  process.exitCode = result.failed > 0 ? 1 : 0;
}
