import { ApiError } from '../services/api-client.ts';

/** Mensaje para un error que no viene de la API (un fallo de la propia pantalla). */
export const UNEXPECTED_ERROR_MESSAGE = 'No fue posible procesar la solicitud.';

/** Muestra el mensaje de un error: el que envió el backend, tal cual, si es un error de la API. */
export function ErrorMessage({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError ? error.message : UNEXPECTED_ERROR_MESSAGE;
  return (
    <p role="alert" className="error-message">
      {message}
    </p>
  );
}
