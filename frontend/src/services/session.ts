/**
 * Login simulado (plan base, regla 10): el Módulo 2 no tiene seguridad, así que el frontend solo guarda
 * el nombre de la Recepcionista para enviarlo en `X-User`. Se guarda en la sesión del navegador: al
 * cerrar la pestaña hay que volver a escribirlo.
 */
const STORAGE_KEY = 'hospitua.receptionist';

/** Lo que cabe en `processed_by` (el backend rechaza un `X-User` más largo con `INVALID_USER`). */
export const MAX_USER_LENGTH = 100;

export function currentUser(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // El navegador no permite usar el almacenamiento de la sesión.
    return null;
  }
}

/** Guarda el nombre sin los espacios de los extremos. */
export function signIn(name: string): void {
  sessionStorage.setItem(STORAGE_KEY, name.trim());
}

export function signOut(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** El mensaje del formulario si el nombre no sirve, o `null` si sirve. */
export function nameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Escriba su nombre.';
  }
  if (trimmed.length > MAX_USER_LENGTH) {
    return `El nombre no puede superar ${MAX_USER_LENGTH} caracteres.`;
  }
  return null;
}
