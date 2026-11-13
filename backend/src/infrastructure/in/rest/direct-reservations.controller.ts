import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CREATE_DIRECT_RESERVATION,
  type CreateDirectReservation,
} from '../../../application/use-cases/generate-direct-reservation/ports/in/create-direct-reservation.port.js';
import {
  PREVIEW_DIRECT_RESERVATION,
  type PreviewDirectReservation,
} from '../../../application/use-cases/generate-direct-reservation/ports/in/preview-direct-reservation.port.js';
import { ApiErrorBody } from '../../shared/api-error.js';
import {
  CREATION_ERROR_EXAMPLES,
  CREATION_EXAMPLE,
  CREATION_REQUEST_EXAMPLE,
  DirectReservationCreationRequestDto,
  type DirectReservationPreviewBody,
  DirectReservationPreviewDto,
  DirectReservationPreviewRequestDto,
  PREVIEW_ERROR_EXAMPLES,
  PREVIEW_EXAMPLE,
  PREVIEW_REQUEST_EXAMPLE,
  toDirectReservationPreviewBody,
} from './direct-reservation.dto.js';
import {
  type ReservationDetailBody,
  ReservationDetailDto,
  toReservationDetailBody,
} from './reservation-detail.dto.js';

/** Las rutas de la reserva directa (plan de `generate-direct-reservation`, A y B). */
@Controller('reservations/direct')
export class DirectReservationsController {
  constructor(
    @Inject(PREVIEW_DIRECT_RESERVATION)
    private readonly previewDirectReservation: PreviewDirectReservation,
    @Inject(CREATE_DIRECT_RESERVATION)
    private readonly createDirectReservation: CreateDirectReservation,
  ) {}

  /**
   * A, `POST /api/reservations/direct/preview`: asigna las habitaciones, verifica la disponibilidad y
   * cotiza, sin guardar nada. Responde `200`; los errores de la tabla C salen por el filtro global como
   * `400`. El cuerpo lo revisa el caso de uso, en el orden de la regla 2.
   */
  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'La vista previa de una reserva directa: verifica la disponibilidad de la categoría, asigna las habitaciones (las elegidas por `roomId` o las de menor número) y cotiza cada una con el Módulo 3. No guarda nada.',
  })
  @ApiBody({
    type: DirectReservationPreviewRequestDto,
    examples: {
      PLAN: {
        summary: 'El ejemplo del contrato A del plan',
        value: PREVIEW_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiOkResponse({
    type: DirectReservationPreviewDto,
    description:
      'La disponibilidad de la categoría, las habitaciones asignadas, una cotización por habitación con el total (que no se guarda) y la suma de personas.',
    example: PREVIEW_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Un dato no válido, sin disponibilidad suficiente, el Módulo 1 o el Módulo 3 sin responder, o una excepción inesperada. Sin disponibilidad responde 400, no un 200 con resultados parciales.',
    examples: PREVIEW_ERROR_EXAMPLES,
  })
  async preview(@Body() body: unknown): Promise<DirectReservationPreviewBody> {
    return toDirectReservationPreviewBody(
      await this.previewDirectReservation.execute(body),
    );
  }

  /**
   * B, `POST /api/reservations/direct`: crea la reserva (punto 12). Responde `201` con
   * `Location: /api/reservations/{reservationRef}` y el detalle con la forma de C3 de
   * `check-view-reservation`; los errores de la tabla C salen por el filtro global como `400`. Lee la cabecera
   * `Idempotency-Key` (punto 15, T019): sin ella o sin un UUID, `IDEMPOTENCY_KEY_REQUIRED`.
   */
  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Crea una reserva directa en `ACTIVE`: vuelve a verificar la disponibilidad, a asignar y a cotizar, compara con las tarifas que vio el solicitante y la guarda. Nunca guarda un monto enviado por el cliente.',
  })
  @ApiBody({
    type: DirectReservationCreationRequestDto,
    examples: {
      PLAN: {
        summary: 'El ejemplo del contrato B del plan',
        value: CREATION_REQUEST_EXAMPLE,
      },
    },
  })
  @ApiCreatedResponse({
    type: ReservationDetailDto,
    description:
      'El detalle de la reserva creada, con la forma de C3 de `check-view-reservation`.',
    headers: {
      Location: {
        description: '`/api/reservations/{reservationRef}`, la reserva creada.',
        schema: { type: 'string' },
      },
    },
    example: CREATION_EXAMPLE,
  })
  @ApiBadRequestResponse({
    type: ApiErrorBody,
    description:
      'Un dato no válido, sin disponibilidad suficiente, la tarifa cambió, el Módulo 1 o el Módulo 3 sin responder, o una excepción inesperada. No se guarda nada.',
    examples: CREATION_ERROR_EXAMPLES,
  })
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReservationDetailBody> {
    const detail = await this.createDirectReservation.execute(
      body,
      idempotencyKey,
    );
    response.setHeader(
      'Location',
      `/api/reservations/${detail.reservation.reservationRef}`,
    );
    return toReservationDetailBody(detail);
  }
}
