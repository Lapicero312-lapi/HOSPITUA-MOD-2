import { BusinessError } from '../shared/business-error.js';
import type { DocumentType } from '../shared/enums.js';

export type GuestProps = {
  /** El `guestRef`. */
  id: string;
  firstName: string;
  lastName: string;
  /** Vacío solo en reservas de Booking, que no lo envía; va junto con `documentNumber`. */
  documentType: DocumentType | null;
  documentNumber: string | null;
  /** Nombre del país; si no es `Colombia`, el huésped es extranjero. En Booking puede quedar vacía. */
  nationality: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

/**
 * Titular de una reserva (plan base, "Guest"). Es parte del agregado `Reservation`: cada reserva tiene
 * el suyo, así que corregirlo en una reserva no cambia las demás.
 */
export class Guest {
  private constructor(private readonly props: GuestProps) {}

  static restore(props: GuestProps): Guest {
    const hasDocumentType = props.documentType !== null;
    const hasDocumentNumber =
      props.documentNumber !== null && props.documentNumber.trim() !== '';
    if (
      props.firstName.trim() === '' ||
      props.lastName.trim() === '' ||
      hasDocumentType !== hasDocumentNumber
    ) {
      throw new BusinessError(
        'GUEST_DATA_REQUIRED',
        'Los datos del titular son obligatorios.',
      );
    }
    return new Guest({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  /** El nombre completo se arma uniendo nombres y apellidos (diccionario). */
  get fullName(): string {
    return `${this.props.firstName} ${this.props.lastName}`;
  }

  get documentType(): DocumentType | null {
    return this.props.documentType;
  }

  get documentNumber(): string | null {
    return this.props.documentNumber;
  }

  get nationality(): string | null {
    return this.props.nationality;
  }

  get contactPhone(): string | null {
    return this.props.contactPhone;
  }

  get contactEmail(): string | null {
    return this.props.contactEmail;
  }

  /** Una copia de sus datos, para crear el titular corregido. */
  snapshot(): GuestProps {
    return { ...this.props };
  }
}
