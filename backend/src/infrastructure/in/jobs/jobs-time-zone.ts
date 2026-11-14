/**
 * Zona horaria de todas las tareas programadas (plan base, "Decisiones de stack"): `@Cron(..., { timeZone })`.
 * Va en su propio archivo porque `@Cron` la lee al definir la clase de la tarea, y `JobsModule` importa
 * esas clases: si viviera en `jobs.module.ts`, la importación sería circular.
 */
export const JOBS_TIME_ZONE = 'America/Bogota';
