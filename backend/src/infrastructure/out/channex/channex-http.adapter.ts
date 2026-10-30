import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AxiosRequestConfig } from 'axios';
import {
  type AvailabilityRange,
  type BookingFeedPage,
  ChannexRateLimitedError,
  ChannexRejectedError,
  type ChannexPort,
  type ChannexRoomType,
  type ChannexRoomTypeInput,
  ChannexUnauthorizedError,
  ChannexUnavailableError,
} from '../../../application/ports/out/channex.port.js';
import { isNonEmptyString, isObject, send } from '../http-call.js';
import {
  isUnreadable,
  readBookingRevision,
} from './booking-revision.reader.js';
import { ChannexPause } from './channex-pause.js';

/** Revisiones por página del feed: el máximo que acepta Channex. */
export const FEED_PAGE_LIMIT = 100;

type ChannexSettings = { baseUrl: string; apiKey: string; propertyId: string };

/**
 * Cliente HTTP de Channex (plan base, "`ChannexPort`"), con un tiempo máximo de espera de 10 s. Contratos
 * en `configure-ota` (A0 a A4) y `generate-ota-reservation` (A1 a A3). Pone la cabecera `user-api-key`
 * y la propiedad en cada llamada; la clave nunca sale en los logs ni en los errores. Ante un 429 pausa
 * todas las llamadas de la propiedad. No valida la configuración (eso es de `configure-ota`): si falta,
 * cada llamada falla sin salir a Channex.
 */
@Injectable()
export class ChannexHttpAdapter implements ChannexPort {
  private readonly logger = new Logger(ChannexHttpAdapter.name);
  private readonly pause = new ChannexPause();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async listProperties(): Promise<{ id: string; title: string }[]> {
    const body = await this.call({
      method: 'GET',
      url: '/api/v1/properties/options',
    });
    return dataList(body).map((attributes) => {
      if (
        !isNonEmptyString(attributes.id) ||
        typeof attributes.title !== 'string'
      ) {
        throw invalid('una propiedad sin id o sin title');
      }
      return { id: attributes.id, title: attributes.title };
    });
  }

  async listRoomTypes(): Promise<ChannexRoomType[]> {
    const { propertyId } = this.settings();
    const body = await this.call({
      method: 'GET',
      url: '/api/v1/room_types/options',
      params: { 'filter[property_id]': propertyId },
    });
    // La ruta no documenta filtros: además se descartan los tipos de otras propiedades.
    return dataList(body)
      .filter((attributes) => attributes.property_id === propertyId)
      .map(toRoomType);
  }

  async createRoomType(input: ChannexRoomTypeInput): Promise<ChannexRoomType> {
    const body = await this.call({
      method: 'POST',
      url: '/api/v1/room_types',
      data: this.roomTypeBody(input),
    });
    const data = isObject(body) ? body.data : undefined;
    return toRoomType(isObject(data) ? data.attributes : undefined);
  }

  async updateRoomType(id: string, input: ChannexRoomTypeInput): Promise<void> {
    await this.request({
      method: 'PUT',
      url: `/api/v1/room_types/${encodeURIComponent(id)}`,
      data: this.roomTypeBody(input),
    });
  }

  async pushAvailability(
    values: AvailabilityRange[],
  ): Promise<{ warnings: string[] }> {
    const { propertyId } = this.settings();
    const body = await this.call({
      method: 'POST',
      url: '/api/v1/availability',
      data: {
        values: values.map((value) => ({
          property_id: propertyId,
          room_type_id: value.roomTypeId,
          date_from: value.dateFrom,
          date_to: value.dateTo,
          availability: value.availability,
        })),
      },
    });
    const meta = isObject(body) ? body.meta : undefined;
    const warnings = isObject(meta) ? meta.warnings : undefined;
    return {
      warnings: Array.isArray(warnings)
        ? warnings.map((warning) =>
            typeof warning === 'string' ? warning : JSON.stringify(warning),
          )
        : [],
    };
  }

  async fetchBookingFeed(page: number): Promise<BookingFeedPage> {
    const { propertyId } = this.settings();
    const body = await this.call({
      method: 'GET',
      url: '/api/v1/booking_revisions/feed',
      params: {
        'filter[property_id]': propertyId,
        'order[inserted_at]': 'asc',
        'pagination[page]': page,
        'pagination[limit]': FEED_PAGE_LIMIT,
      },
    });
    const meta = isObject(body) ? body.meta : undefined;
    const total = isObject(meta) ? meta.total : undefined;
    if (
      !isObject(body) ||
      !Array.isArray(body.data) ||
      typeof total !== 'number' ||
      !Number.isInteger(total) ||
      total < 0
    ) {
      throw invalid('el feed sin data o sin meta.total');
    }
    const revisions = [];
    for (const item of body.data) {
      const revision = readBookingRevision(item);
      if (isUnreadable(revision)) {
        // Sin datos personales: solo el id de la revisión y el motivo.
        this.logger.warn(
          `Revisión ${revision.id ?? 'sin id'} del feed de Channex omitida: ${revision.reason}`,
        );
        continue;
      }
      revisions.push(revision);
    }
    return { revisions, total };
  }

  async ackBookingRevision(revisionId: string): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/api/v1/booking_revisions/${encodeURIComponent(revisionId)}/ack`,
    });
  }

  async reportNoShow(bookingId: string): Promise<void> {
    await this.request({
      method: 'POST',
      url: `/api/v1/bookings/${encodeURIComponent(bookingId)}/no_show`,
      data: { no_show_report: { waived_fees: true } },
    });
  }

  /** El cuerpo de A2 y A3: el resto de los campos los fija `configure-ota`. */
  private roomTypeBody(input: ChannexRoomTypeInput) {
    return {
      room_type: {
        property_id: this.settings().propertyId,
        title: input.title,
        count_of_rooms: input.countOfRooms,
        occ_adults: input.occupancy,
        occ_children: 0,
        occ_infants: 0,
        default_occupancy: input.occupancy,
        room_kind: 'room',
      },
    };
  }

  /** Una llamada cuya respuesta se usa: el cuerpo de un 2xx, que debe ser JSON. */
  private async call(config: AxiosRequestConfig): Promise<unknown> {
    const body = await this.request(config);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw invalid('la respuesta no es JSON');
    }
  }

  /**
   * 2xx: el cuerpo como texto, sin leerlo (A3 de `configure-ota` y A2 y A3 de
   * `generate-ota-reservation` solo necesitan saber que salió bien). 429: pausa. 401 o 403: sin acceso.
   * Otro 4xx: rechazo. Lo demás: no disponible.
   */
  private async request(config: AxiosRequestConfig): Promise<string> {
    const { baseUrl, apiKey } = this.settings();
    if (this.pause.isActive()) {
      throw new ChannexRateLimitedError();
    }
    const outcome = await send(this.http, {
      ...config,
      url: `${baseUrl}${config.url}`,
      headers: {
        'user-api-key': apiKey,
        Accept: 'application/json',
        ...(config.data === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      data: config.data === undefined ? undefined : JSON.stringify(config.data),
    });
    if (outcome.kind === 'no-response') {
      throw new ChannexUnavailableError(outcome.reason);
    }
    if (outcome.status === 429) {
      this.pause.rateLimited();
      throw new ChannexRateLimitedError();
    }
    this.pause.answered();
    if (outcome.status === 401 || outcome.status === 403) {
      throw new ChannexUnauthorizedError(outcome.status);
    }
    if (outcome.status >= 400 && outcome.status < 500) {
      throw new ChannexRejectedError(outcome.status, errorCode(outcome.body));
    }
    if (outcome.status < 200 || outcome.status >= 300) {
      throw new ChannexUnavailableError(`respondió ${outcome.status}`);
    }
    return outcome.body;
  }

  private settings(): ChannexSettings {
    const baseUrl = this.text('CHANNEX_BASE_URL');
    const apiKey = this.text('CHANNEX_API_KEY');
    const propertyId = this.text('CHANNEX_PROPERTY_ID');
    if (baseUrl === null || apiKey === null || propertyId === null) {
      throw new ChannexUnavailableError('configuración incompleta');
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, propertyId };
  }

  private text(name: string): string | null {
    const value = this.config.get<string>(name)?.trim();
    return value ? value : null;
  }
}

function invalid(detail: string): ChannexUnavailableError {
  return new ChannexUnavailableError(`respuesta con otra forma: ${detail}`);
}

/** Los `attributes` de cada elemento de `data` (las rutas `options` de Channex). */
function dataList(body: unknown): Record<string, unknown>[] {
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw invalid('sin data');
  }
  return body.data.map((item) => {
    const attributes = isObject(item) ? item.attributes : undefined;
    if (!isObject(attributes)) {
      throw invalid('un elemento sin attributes');
    }
    return attributes;
  });
}

function toRoomType(attributes: unknown): ChannexRoomType {
  if (
    !isObject(attributes) ||
    !isNonEmptyString(attributes.id) ||
    typeof attributes.title !== 'string' ||
    typeof attributes.default_occupancy !== 'number' ||
    !Number.isInteger(attributes.default_occupancy)
  ) {
    throw invalid('un tipo de habitación sin id, title o default_occupancy');
  }
  return {
    id: attributes.id,
    title: attributes.title,
    defaultOccupancy: attributes.default_occupancy,
  };
}

/** El `errors.code` de Channex (`resource_not_found`, `validation_error`, ...), o `null`. */
function errorCode(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const errors = isObject(parsed) ? parsed.errors : undefined;
    return isObject(errors) && isNonEmptyString(errors.code)
      ? errors.code
      : null;
  } catch {
    return null;
  }
}
