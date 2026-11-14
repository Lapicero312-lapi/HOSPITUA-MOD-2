import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
    .build();
  SwaggerModule.setup(
    `${API_PREFIX}/docs`,
    app,
    SwaggerModule.createDocument(app, config),
  );
}
