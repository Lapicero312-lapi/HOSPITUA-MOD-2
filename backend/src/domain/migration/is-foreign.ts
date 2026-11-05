/**
 * El huésped es extranjero si su nacionalidad no es exactamente `Colombia` (plan base; plan de
 * `process-guest-data`, punto 8: "comparación exacta; una vacía no es extranjera"). Se deduce, no se guarda.
 */
export function isForeign(nationality: string): boolean {
  return nationality !== '' && nationality !== 'Colombia';
}
