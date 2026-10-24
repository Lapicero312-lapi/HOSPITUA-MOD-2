import { currentUser } from './session.ts';

/** Cuerpo de todo error de la API del Módulo 2 (plan base, "Errores"). */
export type ApiErrorBody = {
  errorCode: string;
  message: string;
  timestamp: string;
  path: string;
};

/** Prefijo de todas las rutas del Módulo 2 (plan base, "Contratos REST"). */
const API_PREFIX = '/api';

/** Código y mensaje cuando el servidor no responde o no responde con el cuerpo de error del plan. */
export const CONNECTION_ERROR = 'CONNECTION_ERROR';
export const CONNECTION_ERROR_MESSAGE =
  'No se pudo conectar con el servidor. Intente de nuevo.';

/**
 * Un error de la API: el `errorCode` y el `message` que envió el backend, que la pantalla muestra tal
 * cual. `status` es `null` si no hubo respuesta.
 */
export class ApiError extends Error {
  readonly errorCode: string;
  readonly status: number | null;

  constructor(errorCode: string, message: string, status: number | null) {
    super(message);
    this.name = 'ApiError';
    this.errorCode = errorCode;
    this.status = status;
  }
}

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PATCH';
  /** Se envía como JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

/**
 * Llama a la API del Módulo 2 y devuelve el JSON de la respuesta. El frontend es la pantalla de la
 * Recepcionista, así que toda llamada lleva `X-Client: RECEPTIONIST` y, si ya escribió su nombre en el
 * login simulado, `X-User` con ese nombre (plan base, regla 10).
 * @throws ApiError con el error que respondió el backend, o `CONNECTION_ERROR` si no hubo respuesta.
 */
export async function apiRequest<T>(
  path: string,
  request: ApiRequest = {},
): Promise<T> {
  const user = currentUser();
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: request.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'X-Client': 'RECEPTIONIST',
        ...(user === null ? {} : { 'X-User': user }),
        ...(request.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...request.headers,
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: request.signal,
    });
  } catch (error) {
    // Una consulta cancelada (la pantalla ya no la necesita) no es un error de conexión.
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(CONNECTION_ERROR, CONNECTION_ERROR_MESSAGE, null);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    if (isApiErrorBody(body)) {
      return new ApiError(body.errorCode, body.message, response.status);
    }
  } catch {
    // El cuerpo no es JSON (por ejemplo, el backend está apagado y responde el servidor de desarrollo).
  }
  return new ApiError(
    CONNECTION_ERROR,
    CONNECTION_ERROR_MESSAGE,
    response.status,
  );
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).errorCode === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}
