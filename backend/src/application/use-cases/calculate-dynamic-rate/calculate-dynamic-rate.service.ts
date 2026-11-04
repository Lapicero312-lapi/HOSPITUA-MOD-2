import { Inject, Injectable, Logger } from '@nestjs/common';
import { BusinessError } from '../../../domain/shared/business-error.js';
import {
  INVALID_CATEGORY,
  INVALID_STAY_DATES,
  PRICING_UNAVAILABLE,
  RATE_CHANGED,
  RECALCULATION_UNAVAILABLE,
} from '../../../domain/shared/error-codes.js';
import type { Money } from '../../../domain/shared/money.js';
import type {
  RoomQuote,
  RoomQuoteRequest,
} from '../../integration/rate-quote.js';
import {
  MODULE3_PORT,
  Module3RejectedError,
  Module3UnavailableError,
  type Module3Port,
} from '../../ports/out/module3.port.js';
import { mapWithLimit } from '../../shared/map-with-limit.js';
import {
  QUOTE_CONCURRENCY,
  type CalculateDynamicRate,
  type QuoteContext,
} from './ports/in/calculate-dynamic-rate.port.js';
import {
  isValidCategoryRoom,
  isValidStayDates,
} from './quote-request.validator.js';

/** El rechazo del Módulo 3 que dice que la categoría no tiene tarifa base (`BASE_RATE_NOT_FOUND`). */
const CATEGORY_NOT_FOUND_STATUS = 404;

/**
 * `CalculateDynamicRate` (plan, B1 y D1): valida cada habitación, la cotiza al Módulo 3 en paralelo con el
 * tope `QUOTE_CONCURRENCY` y traduce sus fallos a los códigos de la tabla de errores. Todo o nada: nunca
 * asume una tarifa ni devuelve cotizaciones a medias.
 */
@Injectable()
export class CalculateDynamicRateService implements CalculateDynamicRate {
  private readonly logger = new Logger(CalculateDynamicRateService.name);

  constructor(
    @Inject(MODULE3_PORT)
    private readonly module3: Module3Port,
    @Inject(QUOTE_CONCURRENCY)
    private readonly concurrency: number,
  ) {}

  async quoteRooms(
    requests: RoomQuoteRequest[],
    context: QuoteContext,
  ): Promise<RoomQuote[]> {
    // Todas se validan antes de llamar al Módulo 3.
    requests.forEach(validate);
    return mapWithLimit(requests, this.concurrency, async (request) => {
      try {
        const quote = await this.module3.createQuote(
          request.categoryRoom,
          request.startDate,
          request.endDate,
        );
        return { ...quote, key: request.key };
      } catch (error) {
        throw this.translate(error, request, context);
      }
    });
  }

  async verifyQuotes(
    seen: { key: string; lodgingAmount: Money }[],
    requests: RoomQuoteRequest[],
    context: QuoteContext,
  ): Promise<RoomQuote[]> {
    const quotes = await this.quoteRooms(requests, context);
    const seenByKey = new Map(
      seen.map(({ key, lodgingAmount }) => [key, lodgingAmount]),
    );
    // Si falta el monto visto de una habitación, el solicitante no vio esa tarifa (plan, punto 10).
    const changed = quotes.some((quote) => {
      const lodgingAmount = seenByKey.get(quote.key);
      return (
        lodgingAmount === undefined ||
        !lodgingAmount.equals(quote.lodgingAmount)
      );
    });
    if (changed) {
      throw new BusinessError(RATE_CHANGED.code, RATE_CHANGED.message);
    }
    return quotes;
  }

  /** La tabla de errores del plan: el rechazo del Módulo 3 y su falta de respuesta, según el contexto. */
  private translate(
    error: unknown,
    request: RoomQuoteRequest,
    context: QuoteContext,
  ): unknown {
    if (error instanceof Module3RejectedError) {
      return error.status === CATEGORY_NOT_FOUND_STATUS
        ? new BusinessError(INVALID_CATEGORY.code, INVALID_CATEGORY.message)
        : new BusinessError(
            INVALID_STAY_DATES.code,
            INVALID_STAY_DATES.message,
          );
    }
    if (error instanceof Module3UnavailableError) {
      // El detalle va al log, sin datos personales: la cotización no tiene ninguno.
      this.logger.warn(
        `Cotización de ${request.categoryRoom} del ${request.startDate} al ${request.endDate}: ${error.message}`,
      );
      const unavailable =
        context === 'NEW_RESERVATION'
          ? PRICING_UNAVAILABLE
          : RECALCULATION_UNAVAILABLE;
      return new BusinessError(unavailable.code, unavailable.message);
    }
    // Un error inesperado sale tal cual: el filtro global lo trata (plan base).
    return error;
  }
}

function validate(request: RoomQuoteRequest): void {
  if (!isValidCategoryRoom(request.categoryRoom)) {
    throw new BusinessError(INVALID_CATEGORY.code, INVALID_CATEGORY.message);
  }
  if (!isValidStayDates(request.startDate, request.endDate)) {
    throw new BusinessError(
      INVALID_STAY_DATES.code,
      INVALID_STAY_DATES.message,
    );
  }
}
