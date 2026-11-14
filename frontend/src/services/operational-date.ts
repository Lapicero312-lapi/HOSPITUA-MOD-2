/**
 * El día operativo: el día de hoy en Colombia (`AAAA-MM-DD`), fijo de 00:00 a 23:59 en `America/Bogota`
 * (diccionario, "Día operativo"), sin depender de la zona horaria del computador.
 */
export function todayInColombia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
