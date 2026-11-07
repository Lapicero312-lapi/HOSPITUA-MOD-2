import { addDays } from './format';

export interface DirectFormValues { startDate: string; endDate: string; categoryRoom: string; guestCounts: number[] }

/** Misma validación y mismos mensajes literales que el plan (orden: habitaciones, personas, fechas). */
export function validateDirectForm(v: DirectFormValues, today: string): string | null {
  if (v.guestCounts.length < 1 || v.guestCounts.length > 10) return 'Una reserva debe tener entre 1 y 10 habitaciones.';
  if (v.guestCounts.some((n) => !Number.isInteger(n))) return 'La cantidad de personas debe ser un número entero mayor que cero.';
  if (v.guestCounts.some((n) => n < 1)) return 'Cada habitación debe tener al menos una persona.';
  if (!v.startDate || !v.endDate) return 'La fecha de salida debe ser posterior a la de entrada.';
  if (v.startDate < today) return 'La fecha de entrada no puede ser anterior a hoy.';
  if (v.endDate <= v.startDate) return 'La fecha de salida debe ser posterior a la de entrada.';
  if (!v.categoryRoom) return 'Elija una categoría.';
  return null;
}
export const defaultDates = (today: string) => ({ startDate: today, endDate: addDays(today, 3) });
