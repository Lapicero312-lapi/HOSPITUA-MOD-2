// Cliente único de la API. Plan base, regla 10: sin seguridad; X-Client dice quién llama y X-User quién actúa.
export class ApiError extends Error {
  constructor(public errorCode: string, message: string, public status: number) { super(message); }
}

let currentUser = '';
export const setApiUser = (name: string) => { currentUser = name; };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = typeof init.body === 'string';
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (hasBody) headers.set('Content-Type', 'application/json');
  headers.set('X-Client', 'RECEPTIONIST');
  headers.set('X-User', encodeURIComponent(currentUser));
  let res: Response;
  try { res = await fetch(`/api${path}`, { ...init, headers }); }
  catch { throw new ApiError('NETWORK_ERROR', 'No hay conexión con el servidor. Intente de nuevo.', 0); }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.errorCode ?? 'UNKNOWN', body?.message ?? 'Ocurrió un error inesperado.', res.status);
  }
  return res.json() as Promise<T>;
}
