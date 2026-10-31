import { Decimal } from 'decimal.js';
import { BusinessError } from '../shared/business-error.js';
import type { ConnectionStatus } from '../shared/enums.js';

export type OtaProps = {
  id: string;
  name: string;
  /**
   * Porcentaje de comisión fijo de la agencia, de 0 a 100, como texto decimal (`15.00` es el 15 %). Lo
   * calcula el sistema con su primera reserva; `null` hasta entonces (plan base, "Ota").
   */
  commissionPercentage: string | null;
  connectionStatus: ConnectionStatus;
  linkedAt: Date;
  /** Última lectura del feed de Channex que terminó bien. */
  lastSyncAt: Date;
};

/** Agencia (plan base, "Ota"). Se registra al iniciar (`configure-ota`); nunca se borra. */
export class Ota {
  private constructor(private readonly props: OtaProps) {}

  static restore(props: OtaProps): Ota {
    const invalid = [
      props.name.trim() === '' ? 'name' : null,
      props.commissionPercentage === null ||
      isPercentage(props.commissionPercentage)
        ? null
        : 'commissionPercentage',
    ].filter((field) => field !== null);
    if (invalid.length > 0) {
      throw new BusinessError(
        'INVALID_OTA_DATA',
        `Datos de la agencia inválidos: ${invalid.join(', ')}.`,
      );
    }
    return new Ota({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  /** `null` mientras la agencia no tenga su primera reserva. */
  get commissionPercentage(): string | null {
    return this.props.commissionPercentage;
  }

  get connectionStatus(): ConnectionStatus {
    return this.props.connectionStatus;
  }

  get linkedAt(): Date {
    return this.props.linkedAt;
  }

  get lastSyncAt(): Date {
    return this.props.lastSyncAt;
  }

  /** Una copia de sus datos, para crear la agencia actualizada. */
  snapshot(): OtaProps {
    return { ...this.props };
  }
}

/** Un número de 0 a 100 con hasta dos decimales (columna `numeric(5,2)`). */
export function isPercentage(value: string): boolean {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) {
    return false;
  }
  const percentage = new Decimal(value);
  return percentage.gte(0) && percentage.lte(100);
}
