import { inject } from 'vitest';
import type {} from '../../integration/global-setup.js';

/**
 * Las e2e arrancan `AppModule` contra el PostgreSQL de Testcontainers (plan base: desde que un caso de
 * uso usa la base). Se asigna antes de importar las pruebas, porque `AppConfigModule` lee el entorno al
 * importarse.
 *
 * La clave de Channex se deja vacía a propósito: las variables del sistema ganan sobre `backend/.env`, y
 * así las pruebas nunca llaman al Channex real con la clave de quien las corre. Sin clave, las tareas de
 * Channex quedan apagadas (`configure-ota`, B0).
 */
Object.assign(process.env, {
  NODE_ENV: 'test',
  ...inject('integrationEnv'),
  CHANNEX_API_KEY: '',
});
