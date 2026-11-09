/** Misma regla que ResolveSearchCriteria (paso 2): 1-40 caracteres, letras, dígitos, espacios internos y guion. */
export function validateSearch(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return 'Debe proveer un código de reserva válido para la consulta.';
  if (s.length > 40 || !/^[\p{L}\d -]+$/u.test(s))
    return 'Debe proveer un código de reserva válido para la consulta.';
  if (!/\d/.test(s) && s.length < 3 && !/^rsv-/i.test(s))
    return 'La búsqueda por nombre requiere al menos 3 caracteres.';
  return null;
}
export function validateDateRange(from: string, to: string): string | null {
  if (!from && !to) return null;
  if (!from || !to) return 'Debe completar ambas fechas del rango.';
  if (from > to)
    return 'La fecha inicial no puede ser posterior a la fecha final.';
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  return days > 366 ? 'El rango de fechas no puede superar 366 días.' : null;
}
