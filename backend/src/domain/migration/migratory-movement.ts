import type { MovementType } from '../shared/enums.js';

export type MigratoryMovementProps = {
  /** El `movementId`. */
  id: string;
  /** El `GuestData` del huésped. Sus datos personales no se copian aquí (plan base). */
  guestDataId: string;
  movementType: MovementType;
  /** `AAAA-MM-DD`: el `checkInDate` o el `checkOutDate` del mensaje del Módulo 1. */
  movementDate: string;
};

/**
 * La entrada (`ENTRY`) o la salida (`DEPARTURE`) de un huésped (plan base, "MigratoryMovement"). Hay una
 * de cada tipo por `GuestData`, y no se modifica.
 */
export class MigratoryMovement {
  private constructor(private readonly props: MigratoryMovementProps) {}

  static restore(props: MigratoryMovementProps): MigratoryMovement {
    return new MigratoryMovement({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get guestDataId(): string {
    return this.props.guestDataId;
  }

  get movementType(): MovementType {
    return this.props.movementType;
  }

  get movementDate(): string {
    return this.props.movementDate;
  }

  /** Una copia de sus datos, para guardarla. */
  snapshot(): MigratoryMovementProps {
    return { ...this.props };
  }
}
