import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { parse } from 'lossless-json';
import type {
  NightlyRate,
  RateQuote,
} from '../../../application/integration/rate-quote.js';
import {
  Module3RejectedError,
  Module3UnavailableError,
  type Module3Port,
} from '../../../application/ports/out/module3.port.js';
import { Money } from '../../../domain/shared/money.js';
import { isNonEmptyString, isObject, isRealDate, send } from '../http-call.js';

/** Un importe con hasta dos decimales (la columna es `numeric(14,2)`), sin signo. */
const AMOUNT_FORMAT = /^\d{1,12}(\.\d{1,2})?$/;
const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/**
 * Cliente HTTP del Módulo 3, con su tiempo máximo de espera (`MODULE3_TIMEOUT_MS`). Contrato en
 * `calculate-dynamic-rate` (A1). Sin reintentos. Los importes se leen como texto, nunca como `number`
 * (NFR-002), y no se redondean: una cotización con más de dos decimales se rechaza.
 */
@Injectable()
export class Module3HttpAdapter implements Module3Port {
  constructor(private readonly http: HttpService) {}

  async createQuote(
    roomType: string,
    checkInDate: string,
    checkOutDate: string,
  ): Promise<RateQuote> {
    const outcome = await send(this.http, {
      method: 'POST',
      url: '/pricing/quotes',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ roomType, checkInDate, checkOutDate }),
    });
    if (outcome.kind === 'no-response') {
      throw new Module3UnavailableError(outcome.reason);
    }
    if (outcome.status >= 400 && outcome.status < 500) {
      throw new Module3RejectedError(outcome.status);
    }
    if (outcome.status !== 200 && outcome.status !== 201) {
      throw new Module3UnavailableError(`respondió ${outcome.status}`);
    }
    return toRateQuote(readLossless(outcome.body), checkInDate, checkOutDate);
  }
}

/** El JSON con todos sus números como texto, tal cual llegaron. */
function readLossless(body: string): unknown {
  try {
    return parse(body, null, (digits: string) => digits);
  } catch {
    throw new Module3UnavailableError('la respuesta no es JSON');
  }
}

function invalidQuote(detail: string): Module3UnavailableError {
  return new Module3UnavailableError(`cotización inválida: ${detail}`);
}

function toRateQuote(
  value: unknown,
  checkInDate: string,
  checkOutDate: string,
): RateQuote {
  if (
    !isObject(value) ||
    !isNonEmptyString(value.quoteId) ||
    typeof value.currency !== 'string' ||
    !CURRENCY_FORMAT.test(value.currency) ||
    !Array.isArray(value.nightlyRates)
  ) {
    throw invalidQuote('campos faltantes o de otro tipo');
  }
  const currency = value.currency;
  const lodgingAmount = toAmount(value.lodgingAmount, currency);
  if (!/[1-9]/.test(lodgingAmount.amount)) {
    throw invalidQuote('lodgingAmount en cero');
  }
  return {
    quoteId: value.quoteId,
    currency,
    nightlyRates: value.nightlyRates.map((night) =>
      toNightlyRate(night, currency, checkInDate, checkOutDate),
    ),
    lodgingAmount,
  };
}

/** Una noche de la estadía: de `checkInDate` hasta el día anterior a `checkOutDate`. */
function toNightlyRate(
  value: unknown,
  currency: string,
  checkInDate: string,
  checkOutDate: string,
): NightlyRate {
  if (
    !isObject(value) ||
    !isRealDate(value.date) ||
    value.date < checkInDate ||
    value.date >= checkOutDate
  ) {
    throw invalidQuote('una noche fuera de la estadía');
  }
  return { date: value.date, rate: toAmount(value.rate, currency) };
}

/** Acepta el importe como número o como texto, pero siempre con el formato de dos decimales. */
function toAmount(value: unknown, currency: string): Money {
  if (typeof value !== 'string' || !AMOUNT_FORMAT.test(value)) {
    throw invalidQuote('importe con otro formato o con más de dos decimales');
  }
  return Money.of(value, currency);
}
