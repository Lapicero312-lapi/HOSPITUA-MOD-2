import { describe, expect, it } from 'vitest';
import { readMaintenanceNotice } from '../../../../../src/infrastructure/in/messaging/maintenance-notice.reader.js';
import { InvalidMessageError } from '../../../../../src/infrastructure/in/messaging/retry-or-dead-letter.js';

const QUEUE = 'm2.habitacion.mantenimiento.queue';

/** El ejemplo de E1 del plan de `configure-ota`. */
const EXAMPLE = {
  messageId: '7c1e9a52-3b0d-4f7e-9a61-2d8c5b4e1f03',
  sequenceNumber: 12,
  maintenanceId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  action: 'UPDATED',
  roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  categoryRoom: 'DOBLE',
  startDate: '2026-11-14',
  endDate: '2026-11-15',
  previousStartDate: '2026-11-12',
  previousEndDate: '2026-11-13',
};

const reasonOf = (message: unknown): string => {
  try {
    readMaintenanceNotice(message, QUEUE);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidMessageError);
    return (error as Error).message;
  }
  throw new Error('El mensaje no se rechazó');
};

describe('readMaintenanceNotice (E1 de configure-ota; T012b)', () => {
  it('el ejemplo de E1: el aviso con sus fechas y las anteriores', () => {
    expect(readMaintenanceNotice(EXAMPLE, QUEUE)).toEqual({
      messageId: EXAMPLE.messageId,
      sequenceNumber: 12,
      queue: QUEUE,
      action: 'UPDATED',
      roomId: EXAMPLE.roomId,
      categoryRoom: 'DOBLE',
      startDate: '2026-11-14',
      endDate: '2026-11-15',
      previous: { startDate: '2026-11-12', endDate: '2026-11-13' },
    });
  });

  it.each(['SCHEDULED', 'CANCELLED'])(
    'con %s no lleva fechas anteriores, aunque vengan',
    (action) => {
      expect(
        readMaintenanceNotice({ ...EXAMPLE, action }, QUEUE).previous,
      ).toBeNull();
    },
  );

  it('un mantenimiento de un solo día (entrada y salida iguales) es válido', () => {
    expect(
      readMaintenanceNotice(
        { ...EXAMPLE, action: 'SCHEDULED', endDate: '2026-11-14' },
        QUEUE,
      ).endDate,
    ).toBe('2026-11-14');
  });

  it.each<[string, unknown, string]>([
    ['vacío', {}, 'messageId'],
    ['que no es un objeto', 'texto', 'messageId'],
    ['sin messageId', { ...EXAMPLE, messageId: undefined }, 'messageId'],
    [
      'con un messageId que no es UUID',
      { ...EXAMPLE, messageId: 'abc' },
      'messageId',
    ],
    [
      'sin sequenceNumber',
      { ...EXAMPLE, sequenceNumber: undefined },
      'sequenceNumber',
    ],
    [
      'con un sequenceNumber negativo',
      { ...EXAMPLE, sequenceNumber: -1 },
      'sequenceNumber',
    ],
    [
      'con un sequenceNumber decimal',
      { ...EXAMPLE, sequenceNumber: 1.5 },
      'sequenceNumber',
    ],
    ['sin roomId', { ...EXAMPLE, roomId: undefined }, 'roomId'],
    ['con un roomId vacío', { ...EXAMPLE, roomId: '  ' }, 'roomId'],
    [
      'sin categoryRoom',
      { ...EXAMPLE, categoryRoom: undefined },
      'categoryRoom',
    ],
    ['con una action desconocida', { ...EXAMPLE, action: 'DELETED' }, 'action'],
    ['sin action', { ...EXAMPLE, action: undefined }, 'action'],
    [
      'con una fecha que no existe',
      { ...EXAMPLE, startDate: '2026-02-30' },
      'fechas del mantenimiento',
    ],
    [
      'con una fecha mal escrita',
      { ...EXAMPLE, endDate: '15/11/2026' },
      'fechas del mantenimiento',
    ],
    [
      'con la salida antes que la entrada',
      { ...EXAMPLE, endDate: '2026-11-13' },
      'fechas del mantenimiento',
    ],
    [
      'UPDATED sin las fechas anteriores',
      { ...EXAMPLE, previousStartDate: undefined },
      'fechas anteriores',
    ],
    [
      'UPDATED con las anteriores al revés',
      { ...EXAMPLE, previousEndDate: '2026-11-11' },
      'fechas anteriores',
    ],
  ])('un aviso %s va a la dead-letter', (_, message, reason) => {
    expect(reasonOf(message)).toContain(reason);
  });

  it('el motivo no trae datos del mensaje', () => {
    expect(reasonOf({ ...EXAMPLE, roomId: undefined })).not.toContain(
      EXAMPLE.messageId,
    );
  });
});
