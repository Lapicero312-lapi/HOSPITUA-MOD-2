import { createSimulatorServer } from '../src/http.js';

/**
 * Levanta un simulador en un puerto libre, sin escribir en la consola, y devuelve cómo llamarlo y cómo
 * apagarlo.
 * @param {import('../src/http.js').Handler} handler
 */
export async function startSimulator(handler) {
  const log = console.log;
  console.log = () => undefined;
  const server = createSimulatorServer('prueba', handler);
  await new Promise((resolve) => server.listen(0, () => resolve(undefined)));
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  return {
    /**
     * @param {string} path
     * @param {RequestInit} [init]
     */
    async call(path, init) {
      const response = await fetch(`http://localhost:${port}${path}`, init);
      return { status: response.status, body: await response.json() };
    },
    async stop() {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      console.log = log;
    },
  };
}
