import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { module1Handler } from '../src/module1.js';
import {
  describeDailyListMessage,
  movementMessage,
  readMovementRequest,
  sequenceCounter,
} from '../src/module1-messages.js';
import { startSimulator } from './support.js';

const TODAY = '2026-10-09';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Los huéspedes del ejemplo del contrato A de `update-reservation`. */
const GUESTS = [
  {
    firstName: 'Ana',
    lastName: 'Pérez',
    documentType: 'CC',
    documentNumber: '123',
    birthDate: '1995-03-20',
    nationality: 'Colombia',
  },
  {
    firstName: 'John',
    lastName: 'Smith',
    documentType: 'PAS',
    documentNumber: 'X99',
    birthDate: '1990-05-12',
    nationality: 'Estados Unidos',
    originPlace: 'Miami, Estados Unidos',
    destinationPlace: 'Cartagena, Colombia',
  },
];

const REQUEST = {
  reservationRef: 'RSV-8D02E5A4',
  roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  guests: GUESTS,
};

describe('Los avisos de Check-In y Check-Out del Módulo 1 (contrato A de update-reservation)', () => {
  it('el Check-In tiene la forma del contrato: ENTRY y la fecha de hoy a nivel de mensaje, con los huéspedes tal cual', () => {
    const message = movementMessage('check-in', REQUEST, {
      sequenceNumber: 123,
      today: TODAY,
    });

    assert.match(message.messageId, UUID);
    assert.deepEqual(message, {
      messageId: message.messageId,
      sequenceNumber: 123,
      reservationRef: 'RSV-8D02E5A4',
      roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
      movementType: 'ENTRY',
      movementDate: TODAY,
      guests: GUESTS,
    });
  });

  it('el Check-Out es DEPARTURE, y movementDate se puede elegir', () => {
    const message = movementMessage(
      'check-out',
      { ...REQUEST, movementDate: '2026-10-12' },
      { sequenceNumber: 124, today: TODAY },
    );

    assert.equal(message.movementType, 'DEPARTURE');
    assert.equal(message.movementDate, '2026-10-12');
  });

  it('cada mensaje lleva un messageId distinto', () => {
    const context = { sequenceNumber: 1, today: TODAY };
    assert.notEqual(
      movementMessage('check-in', REQUEST, context).messageId,
      movementMessage('check-in', REQUEST, context).messageId,
    );
  });

  it('la secuencia es creciente por cola, empieza en los segundos desde 1970 y no se mezcla entre colas', () => {
    const sequences = sequenceCounter(() => 1_700_000_000_500);

    assert.equal(sequences.next('check-in'), 1_700_000_001);
    assert.equal(sequences.next('check-in'), 1_700_000_002);
    assert.equal(sequences.next('check-out'), 1_700_000_001);
  });

  describe('la solicitud', () => {
    it('acepta la del ejemplo', () => {
      assert.deepEqual(readMovementRequest(REQUEST), {
        ok: true,
        request: REQUEST,
      });
    });

    for (const [name, body] of [
      ['que no es un objeto', []],
      ['sin reservationRef', { ...REQUEST, reservationRef: undefined }],
      [
        'con una referencia en minúsculas',
        { ...REQUEST, reservationRef: 'rsv-8d02e5a4' },
      ],
      ['con un roomId que no es un UUID', { ...REQUEST, roomId: '201' }],
      ['sin huéspedes', { ...REQUEST, guests: [] }],
      ['con una fecha inexistente', { ...REQUEST, movementDate: '2026-02-30' }],
    ]) {
      it(`rechaza una ${name}`, () => {
        assert.equal(readMovementRequest(body).ok, false);
      });
    }
  });
});

describe('El log de la lista del día que recibe el Módulo 1', () => {
  it('la lista: la secuencia, la fecha y los totales, sin datos de los huéspedes', () => {
    const line = describeDailyListMessage('reserva.lista-del-dia', {
      sequenceNumber: 1,
      operationalDate: TODAY,
      totalReservations: 2,
      totalRooms: 3,
      totalGuests: 5,
      reservations: [{ guest: { firstName: 'Ana', documentNumber: '123' } }],
    });

    assert.equal(
      line,
      'Lista del día recibida (secuencia 1 del 2026-10-09): 2 reservas, 3 habitaciones y 5 huéspedes.',
    );
    assert.doesNotMatch(line, /Ana|123/);
  });

  it('una actualización: el tipo, el motivo y la reserva', () => {
    assert.equal(
      describeDailyListMessage('reserva.lista-del-dia.actualizacion', {
        sequenceNumber: 2,
        operationalDate: TODAY,
        updateType: 'REMOVED',
        removalReason: 'CANCELLED',
        reservationRef: 'RSV-3F9A1C7B',
      }),
      'Actualización REMOVED (CANCELLED) de RSV-3F9A1C7B recibida (secuencia 2 del 2026-10-09).',
    );
  });
});

describe('POST /simulate/check-in y /simulate/check-out', () => {
  /** @type {Awaited<ReturnType<typeof startSimulator>>} */
  let simulator;
  /** @type {{ routingKey: string; message: Record<string, unknown> }[]} */
  let published = [];

  before(async () => {
    simulator = await startSimulator(
      module1Handler({
        today: () => TODAY,
        sequences: sequenceCounter(() => 10_000),
        publisher: {
          publish: async (routingKey, message) => {
            published.push({ routingKey, message });
          },
          close: async () => undefined,
        },
      }),
    );
  });

  beforeEach(() => {
    published = [];
  });

  after(async () => {
    await simulator.stop();
  });

  const post = (path, body) =>
    simulator.call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('el Check-In sale por habitacion.checkin y responde 202 con el mensaje', async () => {
    const res = await post('/simulate/check-in', REQUEST);

    assert.equal(res.status, 202);
    assert.equal(published.length, 1);
    assert.equal(published[0].routingKey, 'habitacion.checkin');
    assert.deepEqual(res.body, published[0].message);
    assert.equal(res.body.movementType, 'ENTRY');
    assert.equal(res.body.sequenceNumber, 11);
  });

  it('el Check-Out sale por habitacion.checkout', async () => {
    const res = await post('/simulate/check-out', REQUEST);

    assert.equal(res.status, 202);
    assert.equal(published[0].routingKey, 'habitacion.checkout');
    assert.equal(res.body.movementType, 'DEPARTURE');
  });

  it('una solicitud inválida responde 400 y no publica nada', async () => {
    const res = await post('/simulate/check-in', { ...REQUEST, roomId: '201' });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_BODY');
    assert.equal(published.length, 0);
  });

  it('un cuerpo que no es JSON responde 400', async () => {
    const res = await post('/simulate/check-in', '{no es json');

    assert.equal(res.status, 400);
    assert.equal(published.length, 0);
  });

  it('el inventario sigue respondiendo igual', async () => {
    const res = await simulator.call('/api/rooms');

    assert.equal(res.status, 200);
  });
});

describe('Sin RabbitMQ (sin RABBITMQ_URL)', () => {
  it('POST /simulate/check-in responde 404, como cualquier ruta que no es del contrato', async () => {
    const simulator = await startSimulator(
      module1Handler({ today: () => TODAY }),
    );
    try {
      const res = await simulator.call('/simulate/check-in', {
        method: 'POST',
        body: JSON.stringify(REQUEST),
      });
      assert.equal(res.status, 404);
    } finally {
      await simulator.stop();
    }
  });
});
