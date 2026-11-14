/**
 * La relación de un tipo de habitación de Channex con una categoría del Módulo 2 (plan base,
 * "OtaRoomTypeMapping"; plan de `configure-ota`, B). Un tipo por categoría, y viceversa. Es de la
 * propiedad, no de la agencia.
 */
export type OtaRoomTypeMapping = {
  channexRoomTypeId: string;
  categoryRoom: string;
  /** Las habitaciones vendibles enviadas a Channex la última vez; nunca menos de 1. */
  countOfRooms: number;
  /** La capacidad máxima enviada a Channex la última vez. */
  occupancy: number;
};
