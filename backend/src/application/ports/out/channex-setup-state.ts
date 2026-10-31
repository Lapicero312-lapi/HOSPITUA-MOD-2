/** Símbolo con el que Nest inyecta el puerto (plan base, regla 4). */
export const CHANNEX_SETUP_STATE = Symbol('CHANNEX_SETUP_STATE');

/**
 * La configuración de Channex ya validada (`configure-ota`, B0). La clave no está aquí: solo la usa el
 * adaptador de `ChannexPort`. El id del hotel de Booking se indica en Channex y el porcentaje de comisión
 * lo calcula el sistema con la primera reserva: ninguno de los dos se configura.
 */
export type ChannexSettings = {
  baseUrl: string;
  propertyId: string;
  syncIntervalSeconds: number;
  ariDays: number;
};

/**
 * Si las tareas de Channex pueden trabajar (`configure-ota`, B0). Las de `configure-ota` y
 * `generate-ota-reservation` no hacen nada mientras `isReady()` sea `false`.
 */
export interface ChannexSetupState {
  /** La configuración válida, o `null` si alguna variable falta o es inválida. */
  settings(): ChannexSettings | null;

  /** Si la configuración es válida y la propiedad ya se verificó en Channex (A0). */
  isReady(): boolean;

  /** Si las tareas quedaron apagadas hasta el siguiente arranque. */
  isDisabled(): boolean;

  /** La propiedad se verificó: las tareas pueden trabajar. */
  markReady(): void;

  /** La propiedad no existe o Channex rechazó la clave: las tareas quedan apagadas hasta reiniciar. */
  disable(): void;
}
