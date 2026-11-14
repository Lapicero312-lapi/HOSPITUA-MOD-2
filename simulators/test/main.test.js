import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));

/** Una cotización válida del Módulo 3. */
const QUOTE = {
  method: 'POST',
  body: JSON.stringify({
    roomType: 'DOBLE',
    checkInDate: '2026-10-10',
    checkOutDate: '2026-10-11',
  }),
};

/**
 * Arranca `src/main.js` como lo hace `pnpm --filter simulators start`, con las variables pedidas y sin las
 * de los puertos que tenga el entorno.
 * @param {Record<string, string>} env
 */
function startMain(env = {}) {
  const base = { ...process.env };
  delete base.PORT;
  delete base.MODULE1_SIMULATOR_PORT;
  delete base.MODULE3_SIMULATOR_PORT;
  // Sin RabbitMQ: estas pruebas son del HTTP, y la conexión la prueba `module1-rabbitmq.test.js`.
  delete base.RABBITMQ_URL;
  return spawn(process.execPath, [MAIN], {
    env: { ...base, ...env },
    stdio: 'ignore',
  });
}

/**
 * Llama al puerto hasta que el simulador responda (mientras arranca, la conexión se rechaza).
 * @param {number} port
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function call(port, path, init) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}${path}`, init);
      return { status: response.status, body: await response.json() };
    } catch (error) {
      if (attempt >= 100) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** @param {import('node:child_process').ChildProcess} child */
function stop(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

describe('main.js sin PORT: cada simulador en su puerto de desarrollo', () => {
  /** @type {import('node:child_process').ChildProcess} */
  let child;

  before(() => {
    child = startMain();
  });

  after(async () => {
    await stop(child);
  });

  it('el Módulo 1 responde en el 4001, el de MODULE1_BASE_URL en desarrollo', async () => {
    const { status, body } = await call(4001, '/api/rooms');

    assert.equal(status, 200);
    assert.equal(body.length, 4);
  });

  it('el Módulo 3 responde en el 4003, el de MODULE3_BASE_URL en desarrollo', async () => {
    const { status, body } = await call(4003, '/pricing/quotes', QUOTE);

    assert.equal(status, 200);
    assert.equal(body.lodgingAmount, '220000.00');
  });

  it('los manejadores no están cruzados: cada puerto solo responde su módulo', async () => {
    assert.equal((await call(4001, '/pricing/quotes', QUOTE)).status, 404);
    assert.equal((await call(4003, '/api/rooms')).status, 404);
  });
});

describe('main.js con PORT (Render): los dos módulos en ese único puerto', () => {
  const PORT = 4105;
  /** @type {import('node:child_process').ChildProcess} */
  let child;

  before(() => {
    child = startMain({ PORT: String(PORT) });
  });

  after(async () => {
    await stop(child);
  });

  it('el Módulo 1 responde en PORT', async () => {
    const { status, body } = await call(PORT, '/api/rooms');

    assert.equal(status, 200);
    assert.equal(body.length, 4);
  });

  it('el Módulo 3 responde en el mismo PORT', async () => {
    const { status, body } = await call(PORT, '/pricing/quotes', QUOTE);

    assert.equal(status, 200);
    assert.equal(body.lodgingAmount, '220000.00');
  });

  it('no abre los puertos de desarrollo', async () => {
    // Ya respondió en PORT: si también abriera el 4001 o el 4003, ya estarían escuchando.
    await call(PORT, '/api/rooms');
    await assert.rejects(fetch('http://localhost:4001/api/rooms'));
    await assert.rejects(fetch('http://localhost:4003/api/rooms'));
  });
});

describe('main.js con RABBITMQ_URL a un puerto cerrado: RabbitMQ no tumba los simuladores REST', () => {
  const PORT = 4106;
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  let exited = false;

  before(() => {
    // Nadie escucha en el puerto 1: la conexión se rechaza al arrancar.
    child = startMain({
      PORT: String(PORT),
      RABBITMQ_URL: 'amqp://localhost:1',
    });
    child.once('exit', () => {
      exited = true;
    });
  });

  after(async () => {
    if (!exited) {
      await stop(child);
    }
  });

  it('el inventario del Módulo 1 responde', async () => {
    const { status, body } = await call(PORT, '/api/rooms');

    assert.equal(status, 200);
    assert.equal(body.length, 4);
  });

  it('la cotización del Módulo 3 responde', async () => {
    const { status, body } = await call(PORT, '/pricing/quotes', QUOTE);

    assert.equal(status, 200);
    assert.equal(body.lodgingAmount, '220000.00');
  });

  it('arranca sin /simulate, y el proceso sigue vivo', async () => {
    const { status } = await call(PORT, '/simulate/check-in', {
      method: 'POST',
      body: '{}',
    });

    assert.equal(status, 404);
    assert.equal(exited, false);
  });
});
