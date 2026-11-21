import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INTERNAL_KEY_SECURITY } from './infrastructure/in/rest/internal-key.guard.js';

/** Prefijo de todas las rutas del Módulo 2 (plan base, "Contratos REST"). */
export const API_PREFIX = 'api';

/**
 * Lo que comparten el arranque (`main.ts`) y las pruebas e2e, para que prueben la misma aplicación: el
 * prefijo `/api` y la documentación OpenAPI en `/api/docs`, visible también en producción. Los
 * controladores declaran su ruta sin el prefijo.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);

  const config = new DocumentBuilder()
    .setTitle('HOSPITUA · Módulo 2')
    .setDescription('API de Operación de Reservas y Cumplimiento Legal')
    .setVersion('0.0.1')
    // La clave que el Módulo 2 exige a los Módulos 1 y 3 (`MODULE2_INTERNAL_KEY`), en las rutas que la piden.
    // Sin opciones, Swagger la documenta en la cabecera con el mismo nombre del esquema: `X-Internal-Key`.
    .addApiKey(undefined, INTERNAL_KEY_SECURITY)
    .build();
  SwaggerModule.setup(
    `${API_PREFIX}/docs`,
    app,
    SwaggerModule.createDocument(app, config),
  );
}
