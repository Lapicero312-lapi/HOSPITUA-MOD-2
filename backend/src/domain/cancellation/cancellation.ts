import type { CancellationChannel } from '../shared/enums.js';

export type CancellationProps = {
  /** El `cancellationId`. */
  id: string;
  /** La reserva cancelada (plan base: estos registros "referencian a la reserva por `reservationRef`"). */
  reservationRef: string;
  cancellationDate: Date;
  /** Opcional. */
  reason: string | null;
  /** `RECEPTION` (la Recepcionista) u `OTA_API` (Booking, por el feed de Channex). */
  channel: CancellationChannel;
  /** Quién la procesó: el nombre que llega en `X-User`, o `Booking.com`. */
  processedBy: string;
  status: 'COMPLETED';
};

/**
 * Registro de la anulación de una reserva (plan base, "Cancellation"; spec de `cancel-reservation`,
 * FR-005). Es inmutable: una vez creado no cambia. Hay una sola por reserva.
 */
export class Cancellation {
  private constructor(private readonly props: CancellationProps) {}

  static restore(props: CancellationProps): Cancellation {
    return new Cancellation({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get reservationRef(): string {
    return this.props.reservationRef;
  }

  get cancellationDate(): Date {
    return this.props.cancellationDate;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  get channel(): CancellationChannel {
    return this.props.channel;
  }

  get processedBy(): string {
    return this.props.processedBy;
  }

  get status(): 'COMPLETED' {
    return this.props.status;
  }

  /** Una copia de sus datos, para guardarla. */
  snapshot(): CancellationProps {
    return { ...this.props };
  }
}
