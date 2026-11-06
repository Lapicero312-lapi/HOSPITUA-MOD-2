/**
 * Símbolo con el que Nest entrega el tope de consultas de mantenimiento al Módulo 1 en paralelo. Lo usan
 * la pantalla "Habitaciones" (`consult-room-inventory`) y la verificación de disponibilidad
 * (`check-room-availability`). El valor viene de la configuración validada (`MAINTENANCE_CONCURRENCY`,
 * mínimo 1) y lo entrega `Module1ClientModule`, así que los servicios no lo vuelven a revisar.
 */
export const MAINTENANCE_CONCURRENCY = Symbol('MAINTENANCE_CONCURRENCY');
