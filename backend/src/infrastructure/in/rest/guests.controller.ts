import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  LOOKUP_GUEST,
  type LookupGuest,
} from '../../../application/use-cases/generate-direct-reservation/ports/in/lookup-guest.port.js';
import type { Guest } from '../../../domain/guest/guest.js';

/** Los datos del titular que precarga el formulario (plan de `generate-direct-reservation`, E). */
type GuestPreload = Pick<
  Guest,
  | 'firstName'
  | 'lastName'
  | 'documentType'
  | 'documentNumber'
  | 'nationality'
  | 'contactPhone'
  | 'contactEmail'
>;

type GuestLookupResponse =
  { found: true; guest: GuestPreload } | { found: false; guest: null };

/** La precarga del titular en la pantalla "Nueva reserva directa" de la Recepcionista. */
@Controller('guests')
export class GuestsController {
  constructor(
    @Inject(LOOKUP_GUEST)
    private readonly lookupGuest: LookupGuest,
  ) {}

  /**
   * E, `GET /api/guests/lookup?documentType=CC&documentNumber=123`: el titular de la reserva más reciente
   * con ese documento, o `{ found: false, guest: null }` si no hay ninguna. Si los parámetros no son
   * válidos, el filtro global responde 400 con el código del validador.
   */
  @Get('lookup')
  async lookup(
    @Query('documentType') documentType: unknown,
    @Query('documentNumber') documentNumber: unknown,
  ): Promise<GuestLookupResponse> {
    const guest = await this.lookupGuest.execute(documentType, documentNumber);
    return guest === null
      ? { found: false, guest: null }
      : { found: true, guest: toPreload(guest) };
  }
}

/** Solo los campos de E: el `id` del titular no sale, porque la reserva nueva tendrá el suyo. */
function toPreload(guest: Guest): GuestPreload {
  return {
    firstName: guest.firstName,
    lastName: guest.lastName,
    documentType: guest.documentType,
    documentNumber: guest.documentNumber,
    nationality: guest.nationality,
    contactPhone: guest.contactPhone,
    contactEmail: guest.contactEmail,
  };
}
