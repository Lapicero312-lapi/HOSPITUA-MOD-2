import type { DocumentType } from '../shared/enums.js';

export type GuestDataProps = {
  id: string;
  /** La reserva (plan base: estos registros "referencian a la reserva por `reservationRef`"). */
  reservationRef: string;
  firstName: string;
  lastName: string;
  documentType: DocumentType;
  documentNumber: string;
  /** `AAAA-MM-DD`. */
  birthDate: string;
  /** El nombre del país, tal como llega del Módulo 1 (`Colombia`, `Venezuela`…). */
  nationality: string;
  /** Lugar de procedencia: SIRE lo exige para los extranjeros; para los colombianos puede venir vacío. */
  originPlace: string | null;
  /** Lugar de destino: igual que `originPlace`. */
  destinationPlace: string | null;
};

/**
 * Los datos de un huésped, colombiano o extranjero, una sola vez por reserva (plan base, "GuestData").
 * Se crea en el Check-In y no se modifica. No valida su contenido: el Módulo 1 los envía completos y
 * correctos (diccionario, "Datos de los Huéspedes").
 */
export class GuestData {
  private constructor(private readonly props: GuestDataProps) {}

  static restore(props: GuestDataProps): GuestData {
    return new GuestData({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get reservationRef(): string {
    return this.props.reservationRef;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get documentType(): DocumentType {
    return this.props.documentType;
  }

  get documentNumber(): string {
    return this.props.documentNumber;
  }

  get birthDate(): string {
    return this.props.birthDate;
  }

  get nationality(): string {
    return this.props.nationality;
  }

  get originPlace(): string | null {
    return this.props.originPlace;
  }

  get destinationPlace(): string | null {
    return this.props.destinationPlace;
  }

  /** Una copia de sus datos, para guardarla. */
  snapshot(): GuestDataProps {
    return { ...this.props };
  }
}
