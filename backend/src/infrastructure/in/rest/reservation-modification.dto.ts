import type { ModificationPreview } from '../../../application/use-cases/update-reservation/ports/in/preview-modification.port.js';
import { type MoneyDto, type QuotesDto, toQuotesDto } from './quotes.dto.js';

/** Una habitación verificada en la vista previa: si está libre en las fechas que quedarían. */
export type ModificationAvailabilityRoomDto = {
  roomId: string;
  roomNumber: string;
  available: boolean;
  reason: 'RESERVED' | 'MAINTENANCE' | null;
};

/** El cuerpo de la respuesta 200 de B1 (plan de `update-reservation`, contrato B y regla 8). */
export type ModificationPreviewBody = Omit<
  ModificationPreview,
  'availability' | 'quotes'
> & {
  availability: { rooms: ModificationAvailabilityRoomDto[] };
  /** Solo las habitaciones recotizadas, sin tarifa anterior ni diferencia, y el total de las que quedarían. */
  quotes: (QuotesDto & { total: MoneyDto }) | null;
};

/**
 * Escribe la vista previa como la recibe la pantalla: la disponibilidad con su `roomId`, su número, si está
 * libre y el motivo; y las cotizaciones con el DTO compartido de `calculate-dynamic-rate` (sin `total`) más
 * el total de todas las habitaciones que quedarían. El `quoteId` no sale.
 */
export function toModificationPreviewBody(
  preview: ModificationPreview,
): ModificationPreviewBody {
  const { availability, quotes, ...rest } = preview;
  return {
    ...rest,
    availability: {
      rooms: availability.map(({ room, available, reason }) => ({
        roomId: room.id,
        roomNumber: room.roomNumber,
        available,
        reason,
      })),
    },
    quotes:
      quotes === null
        ? null
        : {
            ...toQuotesDto(quotes.quotes, quotes.requests, false),
            total: {
              amount: quotes.total.amountWithCents,
              currency: quotes.total.currency,
            },
          },
  };
}
