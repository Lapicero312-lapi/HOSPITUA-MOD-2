import type { BookingRevision } from '../../integration/booking-revision.js';

/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const CHANNEX_PORT = Symbol('CHANNEX_PORT');

/** Un tipo de habitación de la propiedad en Channex. */
export type ChannexRoomType = {
  id: string;
  title: string;
  defaultOccupancy: number;
};

/**
 * Lo que el Módulo 2 decide de un tipo de habitación (`configure-ota`, A2 y A3): el nombre de la
 * categoría, sus habitaciones vendibles (mayor que cero) y la mayor capacidad.
 */
export type ChannexRoomTypeInput = {
  title: string;
  countOfRooms: number;
  occupancy: number;
};

/** La disponibilidad de un tipo de habitación en un rango de fechas, ambas incluidas (`configure-ota`, A4). */
export type AvailabilityRange = {
  roomTypeId: string;
  dateFrom: string;
  dateTo: string;
  availability: number;
};

/** Una página del feed: sus revisiones legibles y el total de revisiones sin confirmar (`meta.total`). */
export type BookingFeedPage = {
  revisions: BookingRevision[];
  total: number;
};

/**
 * Lo que el Módulo 2 pide a Channex (plan base, "`ChannexPort`"): si cambia su API, solo cambia el
 * adaptador. La propiedad (`CHANNEX_PROPERTY_ID`) y la clave las pone el adaptador. Cada método puede
 * lanzar `ChannexUnauthorizedError`, `ChannexRateLimitedError`, `ChannexRejectedError` o
 * `ChannexUnavailableError`; cada caso de uso decide qué hace con cada uno.
 */
export interface ChannexPort {
  /** A0 de `configure-ota`: las propiedades de la cuenta. */
  listProperties(): Promise<{ id: string; title: string }[]>;

  /** A1 de `configure-ota`: los tipos de habitación de la propiedad. */
  listRoomTypes(): Promise<ChannexRoomType[]>;

  /** A2 de `configure-ota`. */
  createRoomType(input: ChannexRoomTypeInput): Promise<ChannexRoomType>;

  /** A3 de `configure-ota`. */
  updateRoomType(id: string, input: ChannexRoomTypeInput): Promise<void>;

  /** A4 de `configure-ota`. Channex responde 200 aunque rechace algún valor: lo dice en `warnings`. */
  pushAvailability(
    values: AvailabilityRange[],
  ): Promise<{ warnings: string[] }>;

  /** A1 de `generate-ota-reservation`: una página (desde 1) de las revisiones sin confirmar, de 100 en 100. */
  fetchBookingFeed(page: number): Promise<BookingFeedPage>;

  /** A2 de `generate-ota-reservation`. */
  ackBookingRevision(revisionId: string): Promise<void>;

  /** A3 de `generate-ota-reservation`: no-show sin penalidad (`waived_fees: true`). */
  reportNoShow(bookingId: string): Promise<void>;
}

/** Channex respondió 401 o 403: la clave no sirve o no tiene acceso a la propiedad. */
export class ChannexUnauthorizedError extends Error {
  constructor(readonly status: number) {
    super(`Channex rechazó la autenticación (${status}).`);
  }
}

/**
 * Channex respondió 429, o la llamada no salió porque los envíos de la propiedad están en pausa por un
 * 429 anterior.
 */
export class ChannexRateLimitedError extends Error {
  constructor() {
    super('Channex limitó las solicitudes de la propiedad (429).');
  }
}

/**
 * Channex respondió otro 4xx (`404` `resource_not_found`, `422` `validation_error` o
 * `method_not_supported`, ...). `code` es el `errors.code` de Channex, o `null` si no lo envió.
 */
export class ChannexRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Channex rechazó la solicitud (${status} ${code ?? 'sin código'}).`);
  }
}

/**
 * Channex no respondió a tiempo, no se pudo conectar, respondió 5xx u otro estado inesperado, envió una
 * respuesta con otra forma, o falta la configuración de Channex.
 */
export class ChannexUnavailableError extends Error {
  constructor(detail: string) {
    super(`Channex no está disponible: ${detail}.`);
  }
}
