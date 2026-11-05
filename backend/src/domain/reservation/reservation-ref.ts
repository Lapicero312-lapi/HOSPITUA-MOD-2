/** Caracteres hexadecimales después de `RSV-` (diccionario, "Referencia de reserva"). */
const HEX_LENGTH = 8;

/**
 * Una referencia de reserva nueva, al azar: `RSV-` y 8 caracteres hexadecimales en mayúscula (por ejemplo
 * `RSV-3F9A1C7B`). Puede coincidir con una que ya existe: quien la guarda genera otra
 * (`withNewReservationRef`). Usa el generador seguro de Node, sin librerías.
 */
export function newReservationRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(HEX_LENGTH / 2));
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `RSV-${hex.toUpperCase()}`;
}
