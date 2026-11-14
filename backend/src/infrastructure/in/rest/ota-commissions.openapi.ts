import { ApiProperty } from '@nestjs/swagger';
import {
  INVALID_AMOUNT,
  INVALID_COMMISSION_STATUS,
  INVALID_RECONCILIATION_ACTION,
  INVALID_RECONCILIATION_REQUEST,
  OTA_NOT_FOUND,
} from '../../../application/use-cases/register-ota-information-commission/error-codes.js';
import {
  COMMISSION_STATUSES,
  RESERVATION_STATUSES,
} from '../../../domain/shared/enums.js';
import {
  DATE_RANGE_TOO_LARGE,
  INCOMPLETE_DATE_RANGE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_PAGE,
  INVALID_RESERVATION_CODE,
  INVALID_STATUS,
} from '../../../domain/shared/error-codes.js';
import {
  REQUEST_NOT_PROCESSED,
  REQUEST_NOT_PROCESSED_MESSAGE,
} from '../../shared/api-error.js';
import { MoneyDto } from './money.dto.js';
import { errorExample } from './openapi-examples.js';

/**
 * La documentación OpenAPI de `register-ota-information-commission` (T021, punto 3 de C de su plan): A1, A2 y
 * A3, con los ejemplos del plan y un ejemplo por cada código de las `400`, en el orden en que se revisan.
 * Las clases solo describen las respuestas; los cuerpos los arman los DTO de cada ruta.
 */

const A1_PATH = '/api/ota-commissions';
const A2_PATH = '/api/ota-commissions/reconciliations';
const A3_DETAIL_PATH = '/api/otas/{otaId}';

const RECONCILIATION_RESULTS = ['APPLIED', 'ALREADY_APPLIED', 'REJECTED'];
const RECONCILIATION_REASONS = [
  'RESERVATION_NOT_FOUND',
  'NOT_OTA_RESERVATION',
  'RESERVATION_CANCELLED',
  'RESERVATION_NO_SHOW',
  'RESERVATION_NOT_COMPLETED',
  'AMOUNT_MISMATCH',
  'INVALID_TRANSITION',
  'REQUEST_NOT_PROCESSED',
];

/** Una comisión de A1. */
export class OtaCommissionDto {
  @ApiProperty({ example: 'RSV-8D02E5A4' })
  reservationRef: string;

  @ApiProperty({ format: 'uuid' })
  otaId: string;

  @ApiProperty({ example: 'Booking.com' })
  otaName: string;

  @ApiProperty({ example: '4417829013' })
  externalConfirmationCode: string;

  @ApiProperty({ enum: RESERVATION_STATUSES, example: 'COMPLETED' })
  status: string;

  @ApiProperty({ format: 'date', example: '2026-10-10' })
  startDate: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-12',
    description: 'El rango de A1 se aplica sobre esta fecha.',
  })
  endDate: string;

  @ApiProperty({
    type: MoneyDto,
    description: 'El valor bruto de la agencia, en su moneda.',
  })
  grossAmount: MoneyDto;

  @ApiProperty({
    type: 'number',
    minimum: 0,
    maximum: 100,
    example: 15,
    description:
      'El de la agencia, congelado en la reserva; un número JSON con hasta dos decimales.',
  })
  commissionPercentage: number;

  @ApiProperty({ type: MoneyDto })
  commissionAmount: MoneyDto;

  @ApiProperty({ enum: COMMISSION_STATUSES, example: 'CALCULATED' })
  commissionStatus: string;
}

/** La respuesta 200 de A1. */
export class OtaCommissionPageDto {
  @ApiProperty({
    type: [OtaCommissionDto],
    description: 'Solo reservas OTA; sin resultados, `[]`.',
  })
  items: OtaCommissionDto[];

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 1,
    description:
      'La página devuelta: una que pasa de la última devuelve la última válida.',
  })
  page: number;

  @ApiProperty({ type: 'integer', example: 100, description: 'Tamaño fijo.' })
  pageSize: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  totalItems: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  totalPages: number;
}

/** Un ítem del cuerpo de A2. */
export class ReconciliationItemDto {
  @ApiProperty({ example: 'RSV-8D02E5A4' })
  reservationRef: string;

  @ApiProperty({
    example: '400.00',
    description:
      'Texto decimal no negativo con hasta dos decimales, en la moneda de la reserva.',
  })
  grossAmount: string;

  @ApiProperty({ example: '60.00' })
  commissionAmount: string;
}

/** El cuerpo de A2. */
export class ReconciliationRequestDto {
  @ApiProperty({ enum: ['RECONCILED', 'PAID'], example: 'RECONCILED' })
  action: string;

  @ApiProperty({
    type: [ReconciliationItemDto],
    description:
      'Entre 1 y `RECONCILIATION_MAX_ITEMS` (500 por defecto). Cada ítem se procesa por separado.',
  })
  items: ReconciliationItemDto[];
}

/** El resultado de un ítem en la respuesta 200 de A2. */
export class ReconciliationResultDto {
  @ApiProperty({ example: 'RSV-8D02E5A4' })
  reservationRef: string;

  @ApiProperty({ enum: RECONCILIATION_RESULTS, example: 'APPLIED' })
  result: string;

  @ApiProperty({
    enum: COMMISSION_STATUSES,
    nullable: true,
    example: 'RECONCILED',
    description:
      'El estado de la comisión después del ítem; `null` si la reserva no existe o es directa.',
  })
  commissionStatus: string | null;

  @ApiProperty({
    enum: RECONCILIATION_REASONS,
    nullable: true,
    example: null,
    description: 'Solo en `REJECTED`.',
  })
  reason: string | null;
}

/** Cuántos ítems quedaron en cada resultado. */
export class ReconciliationSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  applied: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 0 })
  alreadyApplied: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  rejected: number;
}

/** La respuesta 200 de A2. */
export class ReconciliationOutcomeDto {
  @ApiProperty({ enum: ['RECONCILED', 'PAID'], example: 'RECONCILED' })
  action: string;

  @ApiProperty({ type: [ReconciliationResultDto] })
  results: ReconciliationResultDto[];

  @ApiProperty({ type: ReconciliationSummaryDto })
  summary: ReconciliationSummaryDto;
}

/** Una agencia de A3. */
export class OtaDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Booking.com' })
  name: string;

  @ApiProperty({
    type: 'number',
    nullable: true,
    minimum: 0,
    maximum: 100,
    example: 15,
    description: '`null` mientras la agencia no tenga su primera reserva.',
  })
  commissionPercentage: number | null;

  @ApiProperty({ enum: ['CONNECTED', 'DISCONNECTED'], example: 'CONNECTED' })
  connectionStatus: string;

  @ApiProperty({
    example: '2026-03-02T09:14:00-05:00',
    description: 'En hora de Colombia, con segundos.',
  })
  linkedAt: string;

  @ApiProperty({ example: '2026-10-09T07:58:00-05:00' })
  lastSyncAt: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 3,
    description:
      'Reservas de la agencia en `PENDING`, `ACTIVE` o `IN_PROGRESS`.',
  })
  activeReservations: number;
}

/** La respuesta 200 de `GET /api/otas`. */
export class OtaListDto {
  @ApiProperty({
    type: [OtaDto],
    description: 'Una `Ota` desconectada sigue apareciendo.',
  })
  items: OtaDto[];

  @ApiProperty({ type: 'integer', minimum: 0, example: 1 })
  total: number;
}

/** El ejemplo de A1 del plan. */
const OTA_COMMISSION_EXAMPLE = {
  reservationRef: 'RSV-8D02E5A4',
  otaId: '6f1b8c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c',
  otaName: 'Booking.com',
  externalConfirmationCode: '4417829013',
  status: 'COMPLETED',
  startDate: '2026-10-10',
  endDate: '2026-10-12',
  grossAmount: { amount: '400.00', currency: 'USD' },
  commissionPercentage: 15,
  commissionAmount: { amount: '60.00', currency: 'USD' },
  commissionStatus: 'CALCULATED',
};

export const OTA_COMMISSION_PAGE_EXAMPLE = {
  items: [OTA_COMMISSION_EXAMPLE],
  page: 1,
  pageSize: 100,
  totalItems: 1,
  totalPages: 1,
};

/** El ejemplo del cuerpo de A2 del plan. */
export const RECONCILIATION_REQUEST_EXAMPLE = {
  action: 'RECONCILED',
  items: [
    {
      reservationRef: 'RSV-8D02E5A4',
      grossAmount: '400.00',
      commissionAmount: '60.00',
    },
  ],
};

/** El ejemplo de la respuesta de A2 del plan: un ítem aplicado y otro rechazado. */
export const RECONCILIATION_OUTCOME_EXAMPLE = {
  action: 'RECONCILED',
  results: [
    {
      reservationRef: 'RSV-8D02E5A4',
      result: 'APPLIED',
      commissionStatus: 'RECONCILED',
      reason: null,
    },
    {
      reservationRef: 'RSV-1A2B3C4D',
      result: 'REJECTED',
      commissionStatus: 'CALCULATED',
      reason: 'AMOUNT_MISMATCH',
    },
  ],
  summary: { applied: 1, alreadyApplied: 0, rejected: 1 },
};

/** El ejemplo de A3 del plan. */
export const OTA_EXAMPLE = {
  id: '6f1b8c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c',
  name: 'Booking.com',
  commissionPercentage: 15,
  connectionStatus: 'CONNECTED',
  linkedAt: '2026-03-02T09:14:00-05:00',
  lastSyncAt: '2026-10-09T07:58:00-05:00',
  activeReservations: 3,
};

const notProcessed = (path: string) =>
  errorExample(
    path,
    'Una excepción inesperada',
    REQUEST_NOT_PROCESSED,
    REQUEST_NOT_PROCESSED_MESSAGE,
  );

const example = (
  path: string,
  summary: string,
  error: { code: string; message: string },
) => errorExample(path, summary, error.code, error.message);

/** Las 400 de A1, en el orden del punto 1 de C (`readOtaCommissionQuery`). */
export const OTA_COMMISSION_ERROR_EXAMPLES = {
  [INCOMPLETE_DATE_RANGE.code]: example(
    A1_PATH,
    'Falta `dateFrom`, `dateTo` o las dos',
    INCOMPLETE_DATE_RANGE,
  ),
  [INVALID_DATE.code]: example(
    A1_PATH,
    'Una fecha que no es una `AAAA-MM-DD` real',
    INVALID_DATE,
  ),
  [INVALID_DATE_RANGE.code]: example(
    A1_PATH,
    '`dateFrom` posterior a `dateTo`',
    INVALID_DATE_RANGE,
  ),
  [DATE_RANGE_TOO_LARGE.code]: example(
    A1_PATH,
    'Más de 366 días',
    DATE_RANGE_TOO_LARGE,
  ),
  [INVALID_COMMISSION_STATUS.code]: example(
    A1_PATH,
    '`commissionStatus` distinto de `CALCULATED`, `RECONCILED` o `PAID`',
    INVALID_COMMISSION_STATUS,
  ),
  [INVALID_STATUS.code]: example(
    A1_PATH,
    '`reservationStatus` que no es un `ReservationStatus`',
    INVALID_STATUS,
  ),
  [OTA_NOT_FOUND.code]: example(
    A1_PATH,
    '`otaId` que no es un UUID (uno que no existe da `items: []`)',
    OTA_NOT_FOUND,
  ),
  [INVALID_PAGE.code]: example(
    A1_PATH,
    '`page` que no es un entero de 1 en adelante',
    INVALID_PAGE,
  ),
  [REQUEST_NOT_PROCESSED]: notProcessed(A1_PATH),
};

/** Las 400 de A2, en el orden del punto 2 de C (`readReconciliationRequest`). */
export const RECONCILIATION_ERROR_EXAMPLES = {
  [INVALID_RECONCILIATION_REQUEST.code]: example(
    A2_PATH,
    'No es un objeto, o `items` no es una lista, está vacía o tiene más de `RECONCILIATION_MAX_ITEMS`',
    INVALID_RECONCILIATION_REQUEST,
  ),
  [INVALID_RECONCILIATION_ACTION.code]: example(
    A2_PATH,
    '`action` distinta de `RECONCILED` o `PAID`',
    INVALID_RECONCILIATION_ACTION,
  ),
  [INVALID_RESERVATION_CODE.code]: example(
    A2_PATH,
    'Un ítem con `reservationRef` que no es `RSV-` y 8 hexadecimales',
    INVALID_RESERVATION_CODE,
  ),
  [INVALID_AMOUNT.code]: example(
    A2_PATH,
    'Un importe que no es un decimal no negativo con hasta dos decimales',
    INVALID_AMOUNT,
  ),
  [REQUEST_NOT_PROCESSED]: notProcessed(A2_PATH),
};

/** La 400 de `GET /api/otas/{otaId}`. */
export const OTA_ERROR_EXAMPLES = {
  [OTA_NOT_FOUND.code]: example(
    A3_DETAIL_PATH,
    'La agencia no existe, también si `otaId` no es un UUID',
    OTA_NOT_FOUND,
  ),
};
