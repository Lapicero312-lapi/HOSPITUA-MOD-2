import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ROOMS } from '../src/data.js';
import { module1Handler } from '../src/module1.js';
import { startSimulator } from './support.js';

/** El día del ejemplo de C1 de `consult-room-inventory`. */
const TODAY = '2026-10-11';
const [ROOM_201, ROOM_202, ROOM_1001, ROOM_101] = ROOMS;
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
    it('A3: todas las habitaciones, con los cuatro campos del contrato', async () => {
      const { status, body } = await simulator.call('/api/rooms');

      assert.equal(status, 200);
      assert.deepEqual(
        body.map(
          (/** @type {{ roomNumber: string }} */ room) => room.roomNumber,
        ),
        ['201', '202', '1001', '101'],
      );
      for (const room of body) {
        assert.deepEqual(Object.keys(room).sort(), [
          'categoryRoom',
          'id',
          'maxCapacity',
          'roomNumber',
        ]);
      }
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
