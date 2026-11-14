/**
 * Los valores de `X-Client`: quién llama a una ruta que responde distinto según el llamador (plan base,
 * regla 10). No se valida quién es: la seguridad es una capa aparte.
 */
export const CLIENTS = ['RECEPTIONIST', 'MODULE1', 'MODULE3'] as const;
export type Client = (typeof CLIENTS)[number];

export function isClient(value: unknown): value is Client {
  return (
    typeof value === 'string' && (CLIENTS as readonly string[]).includes(value)
  );
}
