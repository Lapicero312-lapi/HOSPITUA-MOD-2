import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { module1Handler } from '../src/module1.js';
import { startSimulator } from './support.js';

/** El día del ejemplo de C1 de `consult-room-inventory`. */
const TODAY = '2026-10-11';

/**
 * Las habitaciones que fija el plan base ("Simuladores del Módulo 1 y del Módulo 3"), escritas aquí y no
 * leídas de `data.js`: si cambian los datos del simulador, la prueba lo nota.
 */
const ROOM_201 = {
  id: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  roomNumber: '201',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_202 = {
  id: '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51',
  roomNumber: '202',
  categoryRoom: 'DOBLE',
  maxCapacity: 3,
};
const ROOM_1001 = {
  id: 'c8e4b2a6-5d7f-4a1c-8e3b-9f0a1b2c3d42',
  roomNumber: '1001',
  categoryRoom: 'DOBLE',
  maxCapacity: 2,
};
const ROOM_101 = {
  id: '5b9f3d7c-2e4a-4b6d-a8c1-7e6f5d4c3b23',
  roomNumber: '101',
  categoryRoom: 'SUITE_JUNIOR',
  maxCapacity: 2,
};
const UNKNOWN_ROOM = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';

describe('Simulador del Módulo 1', () => {
  /** @type {Awaited<ReturnType<typeof startSimulator>>} */
  let simulator;

  before(async () => {
    simulator = await startSimulator(module1Handler({ today: () => TODAY }));
  });

  after(async () => {
    await simulator.stop();
  });

  describe('inventario (consult-room-inventory, A)', () => {
    it('A3: las cuatro habitaciones del plan, con los cuatro campos del contrato', async () => {
      assert.deepEqual(await simulator.call('/api/rooms'), {
        status: 200,
        body: [ROOM_201, ROOM_202, ROOM_1001, ROOM_101],
      });
    });

    it('A2: las habitaciones de una categoría', async () => {
      const { status, body } = await simulator.call(
        '/api/rooms?categoryRoom=DOBLE',
      );

      assert.equal(status, 200);
      assert.deepEqual(body, [ROOM_201, ROOM_202, ROOM_1001]);
    });

    it('A2: una categoría sin habitaciones da una lista vacía', async () => {
      assert.deepEqual(await simulator.call('/api/rooms?categoryRoom=TRIPLE'), {
        status: 200,
        body: [],
      });
    });

    it('A2: una categoría con otra forma da 400', async () => {
      const { status } = await simulator.call('/api/rooms?categoryRoom=doble');

      assert.equal(status, 400);
    });

    it('A1: una habitación por roomId', async () => {
      assert.deepEqual(await simulator.call(`/api/rooms/${ROOM_101.id}`), {
        status: 200,
        body: ROOM_101,
      });
    });

    it('A1: el roomId en mayúsculas encuentra la habitación, porque es el mismo UUID', async () => {
      assert.deepEqual(
        await simulator.call(`/api/rooms/${ROOM_201.id.toUpperCase()}`),
        { status: 200, body: ROOM_201 },
      );
    });

    it('A1: una habitación que no existe da 404', async () => {
      assert.equal(
        (await simulator.call(`/api/rooms/${UNKNOWN_ROOM}`)).status,
        404,
      );
    });

    it('A1: un roomId que no es un UUID da 400', async () => {
      assert.equal((await simulator.call('/api/rooms/201')).status, 400);
    });
  });

  describe('mantenimientos (consult-maintenance-calendar, A1)', () => {
    /**
     * @param {string} roomId
     * @param {string} startDate
     * @param {string} endDate
     */
    const maintenances = (roomId, startDate, endDate) =>
      simulator.call(
        `/api/rooms/${roomId}/maintenances?startDate=${startDate}&endDate=${endDate}`,
      );

    it('la 201 tiene uno del día 9 al 11 después de hoy, como el ejemplo de C1', async () => {
      assert.deepEqual(await maintenances(ROOM_201.id, TODAY, '2026-11-10'), {
        status: 200,
        body: {
          roomId: ROOM_201.id,
          available: false,
          conflicts: [
            { maintenanceStart: '2026-10-20', maintenanceEnd: '2026-10-22' },
          ],
        },
      });
    });

    it('la 1001 tiene uno que ya empezó: de ayer a mañana', async () => {
      const { body } = await maintenances(ROOM_1001.id, TODAY, '2026-10-13');

      assert.deepEqual(body.conflicts, [
        { maintenanceStart: '2026-10-10', maintenanceEnd: '2026-10-12' },
      ]);
    });

    it('el roomId en mayúsculas encuentra la habitación y responde su id tal como está en el inventario', async () => {
      const { status, body } = await maintenances(
        ROOM_201.id.toUpperCase(),
        TODAY,
        '2026-11-10',
      );

      assert.equal(status, 200);
      assert.equal(body.roomId, ROOM_201.id);
      assert.equal(body.available, false);
    });

    it('sin cruce, la habitación está disponible y no trae mantenimientos', async () => {
      assert.deepEqual(
        (await maintenances(ROOM_202.id, TODAY, '2026-11-10')).body,
        {
          roomId: ROOM_202.id,
          available: true,
          conflicts: [],
        },
      );
    });

    it('un mantenimiento que termina justo antes de la llegada no se cruza', async () => {
      assert.equal(
        (await maintenances(ROOM_201.id, '2026-10-23', '2026-10-25')).body
          .available,
        true,
      );
    });

    it('un mantenimiento que empieza el día de la salida no se cruza', async () => {
      assert.equal(
        (await maintenances(ROOM_201.id, '2026-10-18', '2026-10-20')).body
          .available,
        true,
      );
    });

    it('un cruce de un solo día también cuenta', async () => {
      assert.equal(
        (await maintenances(ROOM_201.id, '2026-10-22', '2026-10-24')).body
          .available,
        false,
      );
    });

    it('las fechas siguen a hoy: con otro día, el mantenimiento se corre', async () => {
      const other = await startSimulator(
        module1Handler({ today: () => '2026-12-28' }),
      );
      try {
        const { body } = await other.call(
          `/api/rooms/${ROOM_201.id}/maintenances?startDate=2026-12-28&endDate=2027-01-27`,
        );
        assert.deepEqual(body.conflicts, [
          { maintenanceStart: '2027-01-06', maintenanceEnd: '2027-01-08' },
        ]);
      } finally {
        await other.stop();
      }
    });

    it('una habitación que no existe da 404', async () => {
      assert.equal(
        (await maintenances(UNKNOWN_ROOM, TODAY, '2026-10-13')).status,
        404,
      );
    });

    for (const [caso, startDate, endDate] of [
      ['una fecha mal formada', '11-10-2026', '2026-10-13'],
      ['una fecha que no existe', '2026-02-30', '2026-03-02'],
      ['una fecha sin el día', '2026-10', '2026-10-13'],
      ['la salida igual a la llegada', TODAY, TODAY],
      ['la salida antes de la llegada', '2026-10-13', TODAY],
    ]) {
      it(`con ${caso} da 400`, async () => {
        assert.equal(
          (await maintenances(ROOM_201.id, startDate, endDate)).status,
          400,
        );
      });
    }

    it('sin las fechas da 400', async () => {
      assert.equal(
        (await simulator.call(`/api/rooms/${ROOM_201.id}/maintenances`)).status,
        400,
      );
    });

    it('un roomId que no es un UUID da 400', async () => {
      assert.equal(
        (await maintenances('201', TODAY, '2026-10-13')).status,
        400,
      );
    });
  });

  it('otra ruta o método da 404, nunca 500', async () => {
    assert.equal((await simulator.call('/api/otra')).status, 404);
    assert.equal(
      (await simulator.call('/api/rooms', { method: 'POST' })).status,
      404,
    );
  });

  it('un roomId con un % mal escrito da 400, nunca 500', async () => {
    assert.equal((await simulator.call('/api/rooms/%E0%A4%A')).status, 400);
  });
});
