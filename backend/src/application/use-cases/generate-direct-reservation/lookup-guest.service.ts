import { Inject, Injectable } from '@nestjs/common';
import type { Guest } from '../../../domain/guest/guest.js';
import {
  GUEST_REPOSITORY,
  type GuestRepository,
} from '../../ports/out/guest.repository.js';
import { readGuestDocument } from './guest-document.validator.js';
import type { LookupGuest } from './ports/in/lookup-guest.port.js';

/**
 * Busca el titular por su documento para precargar el formulario (plan, E). La Recepcionista copia sus
 * datos en la reserva nueva, que guarda su propio titular: aquí no se cambia nada.
 */
@Injectable()
export class LookupGuestService implements LookupGuest {
  constructor(
    @Inject(GUEST_REPOSITORY)
    private readonly guests: GuestRepository,
  ) {}

  async execute(
    documentType: unknown,
    documentNumber: unknown,
  ): Promise<Guest | null> {
    const document = readGuestDocument(documentType, documentNumber);
    return this.guests.findLatestByDocument(
      document.documentType,
      document.documentNumber,
    );
  }
}
