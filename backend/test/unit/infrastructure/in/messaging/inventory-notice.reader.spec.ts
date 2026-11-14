import { describe, expect, it } from 'vitest';
import { readInventoryNotice } from '../../../../../src/infrastructure/in/messaging/inventory-notice.reader.js';
import { InvalidMessageError } from '../../../../../src/infrastructure/in/messaging/retry-or-dead-letter.js';

const QUEUE = 'm2.habitacion.inventario.queue';

/** El ejemplo de E2 del plan de `configure-ota`. */
const EXAMPLE = {
  messageId: '0b6f2d14-8e3a-4c5b-b7d9-6a1e3f9c2d57',
  sequenceNumber: 4,
  action: 'UPDATED',
  roomId: '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70',
  categoryRoom: 'SUITE',
  maxCapacity: 4,
  previousCategoryRoom: 'DOBLE',
};

const reasonOf = (message: unknown): string => {
  try {
    readInventoryNotice(message, QUEUE);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidMessageError);
    return (error as Error).message;
  }
  throw new Error('El mensaje no se rechazó');
};

describe('readInventoryNotice (E2 de configure-ota; T012b)', () => {
  it('el ejemplo de E2: el aviso con su categoría anterior', () => {
    expect(readInventoryNotice(EXAMPLE, QUEUE)).toEqual({
      messageId: EXAMPLE.messageId,
      sequenceNumber: 4,
      queue: QUEUE,
      action: 'UPDATED',
      roomId: EXAMPLE.roomId,
      categoryRoom: 'SUITE',
      previousCategoryRoom: 'DOBLE',
    });
  });

  it.each(['ADDED', 'REMOVED', 'UPDATED'])('acepta la action %s', (action) => {
    expect(readInventoryNotice({ ...EXAMPLE, action }, QUEUE).action).toBe(
      action,
    );
  });

  it.each([
    ['sin previousCategoryRoom', {}],
    ['con previousCategoryRoom vacío', { previousCategoryRoom: '  ' }],
    ['con previousCategoryRoom nulo', { previousCategoryRoom: null }],
  ])('%s, previousCategoryRoom es null', (_case, changes) => {
    const { previousCategoryRoom: _omitted, ...rest } = EXAMPLE;

    expect(
      readInventoryNotice({ ...rest, ...changes }, QUEUE).previousCategoryRoom,
    ).toBeNull();
  });

  it('maxCapacity no es obligatorio', () => {
    const { maxCapacity: _omitted, ...rest } = EXAMPLE;

    expect(() => readInventoryNotice(rest, QUEUE)).not.toThrow();
  });

  describe('a la dead-letter (InvalidMessageError)', () => {
    it.each([
      ['sin messageId', { messageId: undefined }],
      ['con un messageId que no es UUID', { messageId: 'abc' }],
      ['sin sequenceNumber', { sequenceNumber: undefined }],
      ['con un sequenceNumber negativo', { sequenceNumber: -1 }],
      ['con un sequenceNumber decimal', { sequenceNumber: 1.5 }],
    ])('%s', (_case, changes) => {
      expect(reasonOf({ ...EXAMPLE, ...changes })).toBe(
        'Falta el messageId o el sequenceNumber, o no tienen el formato.',
      );
    });

    it.each([
      ['sin roomId', { roomId: undefined }],
      ['con roomId vacío', { roomId: ' ' }],
      ['sin categoryRoom', { categoryRoom: undefined }],
      ['con categoryRoom vacío', { categoryRoom: '' }],
    ])('%s', (_case, changes) => {
      expect(reasonOf({ ...EXAMPLE, ...changes })).toBe(
        'Falta el roomId o el categoryRoom.',
      );
    });

    it.each([
      ['sin action', { action: undefined }],
      ['con una action desconocida', { action: 'MOVED' }],
    ])('%s', (_case, changes) => {
      expect(reasonOf({ ...EXAMPLE, ...changes })).toBe(
        'La action del inventario es desconocida.',
      );
    });

    it.each([null, 'texto', 42, []])(
      'un payload que no es un objeto: %j',
      (message) => {
        expect(reasonOf(message)).toBe(
          'Falta el messageId o el sequenceNumber, o no tienen el formato.',
        );
      },
    );

    it('el motivo no lleva datos del mensaje', () => {
      expect(reasonOf({ ...EXAMPLE, roomId: undefined })).not.toContain(
        EXAMPLE.messageId,
      );
    });
  });
});
