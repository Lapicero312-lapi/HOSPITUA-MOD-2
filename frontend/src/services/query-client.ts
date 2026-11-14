import { QueryClient } from '@tanstack/react-query';
import { ApiError, CONNECTION_ERROR } from './api-client.ts';

/**
 * Un error de la API (siempre 4xx, plan base) se repetiría igual: no se reintenta. Sin conexión, se
 * reintenta una vez. Una escritura (crear, modificar o cancelar) nunca se reintenta sola.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  return (
    error instanceof ApiError &&
    error.errorCode === CONNECTION_ERROR &&
    failureCount < 1
  );
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
