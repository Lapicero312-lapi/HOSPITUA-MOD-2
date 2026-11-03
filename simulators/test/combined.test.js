import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { combinedHandler } from '../src/combined.js';
import { ROOMS } from '../src/data.js';
import { startSimulator } from './support.js';

describe('Los dos simuladores en un solo puerto (Render)', () => {
  /** @type {Awaited<ReturnType<typeof startSimulator>>} */
  let simulator;

  before(async () => {
    simulator = await startSimulator(
      combinedHandler({ today: () => '2026-10-11' }),
    );
  });

  after(async () => {
    await simulator.stop();
  });

  it('responde las rutas del Módulo 1', async () => {
    const rooms = await simulator.call('/api/rooms');
    const maintenances = await simulator.call(
      `/api/rooms/${ROOMS[0].id}/maintenances?startDate=2026-10-11&endDate=2026-11-10`,
    );

    assert.equal(rooms.status, 200);
    assert.equal(rooms.body.length, 4);
    assert.equal(maintenances.body.available, false);
  });

  it('responde la cotización del Módulo 3', async () => {
    const { status, body } = await simulator.call('/pricing/quotes', {
      method: 'POST',
      body: JSON.stringify({
        roomType: 'DOBLE',
        checkInDate: '2026-10-10',
        checkOutDate: '2026-10-11',
      }),
    });

    assert.equal(status, 200);
    assert.equal(body.lodgingAmount, '220000.00');
  });

  it('una ruta de ninguno de los dos da 404', async () => {
    assert.equal((await simulator.call('/otra')).status, 404);
    assert.equal(
      (await simulator.call('/pricing/otra', { method: 'POST', body: '{}' }))
        .status,
      404,
    );
  });
});
