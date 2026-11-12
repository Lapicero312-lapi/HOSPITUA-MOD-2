import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CREATE_DIRECT_RESERVATION,
  type CreateDirectReservation,
} from '../../../application/use-cases/generate-direct-reservation/ports/in/create-direct-reservation.port.js';
import {
  PREVIEW_DIRECT_RESERVATION,
  type PreviewDirectReservation,
} from '../../../application/use-cases/generate-direct-reservation/ports/in/preview-direct-reservation.port.js';
import {
  type DirectReservationPreviewBody,
  toDirectReservationPreviewBody,
} from './direct-reservation.dto.js';
import {
  type ReservationDetailBody,
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
  async preview(@Body() body: unknown): Promise<DirectReservationPreviewBody> {
    return toDirectReservationPreviewBody(
      await this.previewDirectReservation.execute(body),
    );
  }

  /**
   * B, `POST /api/reservations/direct`: crea la reserva (punto 12). Responde `201` con
   * `Location: /api/reservations/{reservationRef}` y el detalle con la forma de C3 de
   * `check-view-reservation`; los errores de la tabla C salen por el filtro global como `400`. La
   * `Idempotency-Key` la agrega T019.
   */
  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReservationDetailBody> {
    const detail = await this.createDirectReservation.execute(body);
    response.setHeader(
      'Location',
      `/api/reservations/${detail.reservation.reservationRef}`,
    );
    return toReservationDetailBody(detail);
  }
}
