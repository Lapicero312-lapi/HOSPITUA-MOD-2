import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  PREVIEW_DIRECT_RESERVATION,
  type PreviewDirectReservation,
} from '../../../application/use-cases/generate-direct-reservation/ports/in/preview-direct-reservation.port.js';
import {
  type DirectReservationPreviewBody,
  toDirectReservationPreviewBody,
} from './direct-reservation.dto.js';

/** Las rutas de la reserva directa (plan de `generate-direct-reservation`, A y, en su tarea, B). */
@Controller('reservations/direct')
export class DirectReservationsController {
  constructor(
    @Inject(PREVIEW_DIRECT_RESERVATION)
    private readonly previewDirectReservation: PreviewDirectReservation,
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
}
