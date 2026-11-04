/**
 * Aplica `fn` a cada elemento con, como mucho, `limit` llamadas en curso a la vez, y devuelve los
 * resultados en el mismo orden de `items`. Si una llamada falla, no empieza ninguna más y se rechaza con
 * ese error (las que ya estaban en curso terminan solas). Lo usan las consultas de mantenimiento al
 * Módulo 1, con el tope `MAINTENANCE_CONCURRENCY`.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
