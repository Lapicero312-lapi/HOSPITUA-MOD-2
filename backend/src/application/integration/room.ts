/**
 * Habitación vendible del Módulo 1 (contrato en `consult-room-inventory`, A). No trae estado: todas son
 * vendibles. Es un objeto de integración: no se guarda (plan base, "Datos externos").
 */
export type Room = {
  id: string;
  roomNumber: string;
  /** Mayúsculas, dígitos y `_` (`DOBLE`, `SUITE_JUNIOR`): la clave que comparten los tres módulos. */
  categoryRoom: string;
  /** Al menos 1. */
  maxCapacity: number;
};
