import { module1Handler } from './module1.js';
import { module3Handler } from './module3.js';

/**
 * Los dos simuladores en un solo puerto, para Render, que da un único `PORT` por servicio (plan base,
 * "Despliegue de la demo (Render)"). Sus rutas no se cruzan: `/pricing/…` es del Módulo 3 y todo lo demás
 * (`/api/rooms…` y `/simulate/…`) del Módulo 1.
 * @param {Parameters<typeof module1Handler>[0]} [options] los del Módulo 1: el día y, con RabbitMQ, su
 * publicador
 * @returns {import('./http.js').Handler}
 */
export function combinedHandler(options) {
  const module1 = module1Handler(options);
  const module3 = module3Handler();
  return (request) =>
    request.url.pathname.startsWith('/pricing/')
      ? module3(request)
      : module1(request);
}
