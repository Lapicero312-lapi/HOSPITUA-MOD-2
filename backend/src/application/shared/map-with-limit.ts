/**
 * Aplica `fn` a cada elemento con, como mucho, `limit` llamadas en curso a la vez, y devuelve los
 * resultados en el mismo orden de `items`. Si una llamada falla, no empieza ninguna más y se rechaza con
 * ese error (las que ya estaban en curso terminan solas). Lo usan las consultas de mantenimiento al
 * Módulo 1, con el tope `MAINTENANCE_CONCURRENCY`.
 *
 * Con `shouldStop`, antes de empezar cada llamada se pregunta si ya basta: si devuelve `true`, no empieza
 * ninguna más y las que estaban en curso terminan. Como los elementos se toman en orden, el resultado
 * trae solo los de los primeros elementos, los que sí se llamaron.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  shouldStop: () => boolean = () => false,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length && !shouldStop()) {
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
