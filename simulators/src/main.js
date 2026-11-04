import { createSimulatorServer } from './http.js';
import { module1Handler } from './module1.js';
import { module3Handler } from './module3.js';

/**
 * Arranca los dos simuladores (plan base, "Simuladores del Módulo 1 y del Módulo 3"). Los puertos por
 * defecto son los de `MODULE1_BASE_URL` y `MODULE3_BASE_URL` en desarrollo; se pueden cambiar con
 * `MODULE1_SIMULATOR_PORT` y `MODULE3_SIMULATOR_PORT`.
 */
const simulators = [
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
    console.log(`Simulador del ${name} en http://localhost:${port}`);
  });
}
