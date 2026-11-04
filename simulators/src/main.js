import { combinedHandler } from './combined.js';
import { createSimulatorServer } from './http.js';
import { module1Handler } from './module1.js';
import { module3Handler } from './module3.js';

/**
 * Arranca los simuladores (plan base, "Simuladores del Módulo 1 y del Módulo 3"). Con `PORT`, como en
 * Render, los dos responden en ese único puerto ("Despliegue de la demo (Render)"). Sin ella, cada uno en
 * su puerto: los de `MODULE1_BASE_URL` y `MODULE3_BASE_URL` en desarrollo, que se pueden cambiar con
 * `MODULE1_SIMULATOR_PORT` y `MODULE3_SIMULATOR_PORT`.
 */
const simulators = process.env.PORT
  ? [
      {
        name: 'Módulo 1 y Módulo 3',
        port: Number(process.env.PORT),
        handler: combinedHandler(),
      },
    ]
  : [
      {
        name: 'Módulo 1',
        port: Number(process.env.MODULE1_SIMULATOR_PORT ?? 4001),
        handler: module1Handler(),
      },
      {
        name: 'Módulo 3',
        port: Number(process.env.MODULE3_SIMULATOR_PORT ?? 4003),
        handler: module3Handler(),
      },
    ];

for (const { name, port, handler } of simulators) {
  createSimulatorServer(name, handler).listen(port, () => {
    console.log(`Simulador del ${name} en el puerto ${port}`);
  });
}
