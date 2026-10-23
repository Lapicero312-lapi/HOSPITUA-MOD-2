/**
 * El periodo del cruce entre un mantenimiento y una estadía, o `null` si no se cruzan (plan, "Cómo se
 * determina el cruce"). El mantenimiento bloquea los días de `maintenanceStart` a `maintenanceEnd`,
 * ambos incluidos; la estadía ocupa las noches de `startDate` hasta el día anterior a `endDate`
 * (`endDate` es la salida). En `AAAA-MM-DD`, el orden del texto es el de las fechas.
 *
 * Recibe las fechas ya validadas: no las revisa.
 */
export function overlap(
  maintenance: { maintenanceStart: string; maintenanceEnd: string },
  stay: { startDate: string; endDate: string },
): { overlapStart: string; overlapEnd: string } | null {
  const { maintenanceStart, maintenanceEnd } = maintenance;
  const { startDate, endDate } = stay;

  if (!(maintenanceStart < endDate && maintenanceEnd >= startDate)) {
    return null;
  }

  const dayBeforeEndDate = previousDay(endDate);
  return {
    overlapStart: maintenanceStart > startDate ? maintenanceStart : startDate,
    overlapEnd:
      maintenanceEnd < dayBeforeEndDate ? maintenanceEnd : dayBeforeEndDate,
  };
}

/** El día anterior: se calcula en UTC para que no dependa de la zona horaria del computador. */
function previousDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
