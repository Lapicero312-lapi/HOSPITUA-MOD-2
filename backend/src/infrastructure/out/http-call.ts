import type { HttpService } from '@nestjs/axios';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';

/** Lo que pasó con una solicitud a otro módulo: respondió (con cualquier estado) o no respondió. */
export type HttpOutcome =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'no-response'; reason: string };

/**
 * Hace la solicitud con el tiempo máximo de espera del cliente y devuelve el estado y el cuerpo como
 * texto, sin interpretarlos: cada adaptador decide qué significa cada estado y lee el cuerpo a su manera
 * (el del Módulo 3, sin pasar los importes por `number`).
 */
export async function send(
  http: HttpService,
  config: AxiosRequestConfig,
): Promise<HttpOutcome> {
  try {
    const response = await firstValueFrom(
      http.request<string>({
        ...config,
        responseType: 'text',
        transformResponse: (data: string) => data,
        validateStatus: () => true,
      }),
    );
    return { kind: 'response', status: response.status, body: response.data };
  } catch (error) {
    return { kind: 'no-response', reason: reasonOf(error) };
  }
}

function reasonOf(error: unknown): string {
  if (!(error instanceof AxiosError)) {
    return 'sin respuesta';
  }
  return error.code === AxiosError.ECONNABORTED ||
    error.code === AxiosError.ETIMEDOUT
    ? 'tiempo de espera agotado'
    : `sin respuesta (${error.code ?? 'error de red'})`;
}

/** Una fecha `AAAA-MM-DD` que existe en el calendario (leída en UTC, sin la zona del servidor). */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
