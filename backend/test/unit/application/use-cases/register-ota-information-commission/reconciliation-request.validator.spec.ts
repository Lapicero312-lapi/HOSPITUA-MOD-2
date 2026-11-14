import { describe, expect, it } from 'vitest';
import { readReconciliationRequest } from '../../../../../src/application/use-cases/register-ota-information-commission/reconciliation-request.validator.js';

const MAX = 3;

/** El ejemplo de A2 del plan. */
const ITEM = {
  reservationRef: 'RSV-8D02E5A4',
  grossAmount: '400.00',
  commissionAmount: '60.00',
};

const invalid = (errorCode: string, message: string) =>
  expect.objectContaining({ errorCode, message });

const INVALID_REQUEST = invalid(
  'INVALID_RECONCILIATION_REQUEST',
  'La solicitud de conciliación no es válida.',
);
const INVALID_ACTION = invalid(
  'INVALID_RECONCILIATION_ACTION',
  'La acción de conciliación no es válida.',
);
const INVALID_CODE = invalid(
  'INVALID_RESERVATION_CODE',
  'Debe proveer un código de reserva válido para la consulta.',
);
const INVALID_AMOUNT = invalid('INVALID_AMOUNT', 'El importe no es válido.');

describe('readReconciliationRequest (A2 del plan de register-ota-information-commission)', () => {
  it('devuelve la acción y los ítems del ejemplo del plan', () => {
    expect(
      readReconciliationRequest({ action: 'RECONCILED', items: [ITEM] }, MAX),
    ).toEqual({ action: 'RECONCILED', items: [ITEM] });
  });

  it('acepta PAID y el máximo de ítems', () => {
    const items = [ITEM, ITEM, ITEM];

    expect(readReconciliationRequest({ action: 'PAID', items }, MAX)).toEqual({
      action: 'PAID',
      items,
    });
  });

  it.each([
    ['400', '400'],
    ['con un decimal', '400.5'],
    ['cero', '0'],
    ['cero con decimales', '0.00'],
  ])('acepta un importe %s', (_, amount) => {
    const request = readReconciliationRequest(
      {
        action: 'RECONCILED',
        items: [{ ...ITEM, grossAmount: amount, commissionAmount: amount }],
      },
      MAX,
    );

    expect(request.items[0]).toMatchObject({ grossAmount: amount });
  });

  it.each([
    ['sin cuerpo', undefined],
    ['con el cuerpo vacío', {}],
    ['con un cuerpo que no es un objeto', 'RECONCILED'],
    ['con una lista como cuerpo', [ITEM]],
    ['sin items', { action: 'RECONCILED' }],
    ['con items que no es una lista', { action: 'RECONCILED', items: ITEM }],
    ['con items vacío', { action: 'RECONCILED', items: [] }],
    [
      'con más ítems que el máximo',
      { action: 'RECONCILED', items: [ITEM, ITEM, ITEM, ITEM] },
    ],
  ])(
    'rechaza una solicitud %s con INVALID_RECONCILIATION_REQUEST',
    (_, body) => {
      expect(() => readReconciliationRequest(body, MAX)).toThrow(
        INVALID_REQUEST,
      );
    },
  );

  it.each([
    ['sin acción', undefined],
    ['en minúsculas', 'reconciled'],
    ['distinta de las dos', 'CALCULATED'],
    ['que no es texto', 1],
  ])('rechaza una acción %s con INVALID_RECONCILIATION_ACTION', (_, action) => {
    expect(() =>
      readReconciliationRequest({ action, items: [ITEM] }, MAX),
    ).toThrow(INVALID_ACTION);
  });

  it.each([
    ['sin referencia', undefined],
    ['en minúsculas', 'rsv-8d02e5a4'],
    ['sin el prefijo', '8D02E5A4'],
    ['más corta', 'RSV-8D02E5A'],
    ['con un carácter que no es hexadecimal', 'RSV-8D02E5AZ'],
    ['que no es texto', 12345678],
  ])('rechaza una referencia %s con INVALID_RESERVATION_CODE', (_, ref) => {
    expect(() =>
      readReconciliationRequest(
        { action: 'PAID', items: [{ ...ITEM, reservationRef: ref }] },
        MAX,
      ),
    ).toThrow(INVALID_CODE);
  });

  it('un ítem que no es un objeto no trae referencia: INVALID_RESERVATION_CODE', () => {
    expect(() =>
      readReconciliationRequest(
        { action: 'PAID', items: ['RSV-8D02E5A4'] },
        MAX,
      ),
    ).toThrow(INVALID_CODE);
  });

  it.each([
    ['sin importe', undefined],
    ['negativo', '-1'],
    ['con tres decimales', '400.001'],
    ['con coma', '400,00'],
    ['con separador de miles', '1,000.00'],
    ['con un signo más', '+400'],
    ['vacío', ''],
    ['con letras', '4oo'],
    ['con espacios', ' 400 '],
    ['en notación científica', '4e2'],
    ['un número y no texto', 400],
  ])('rechaza un grossAmount %s con INVALID_AMOUNT', (_, amount) => {
    expect(() =>
      readReconciliationRequest(
        { action: 'PAID', items: [{ ...ITEM, grossAmount: amount }] },
        MAX,
      ),
    ).toThrow(INVALID_AMOUNT);
  });

  it('rechaza un commissionAmount inválido con INVALID_AMOUNT', () => {
    expect(() =>
      readReconciliationRequest(
        { action: 'PAID', items: [{ ...ITEM, commissionAmount: '-60.00' }] },
        MAX,
      ),
    ).toThrow(INVALID_AMOUNT);
  });

  describe('el primero que falla responde, en el orden del plan', () => {
    it('items inválido antes que action inválida', () => {
      expect(() =>
        readReconciliationRequest({ action: 'otra', items: [] }, MAX),
      ).toThrow(INVALID_REQUEST);
    });

    it('action inválida antes que un ítem inválido', () => {
      expect(() =>
        readReconciliationRequest(
          { action: 'otra', items: [{ reservationRef: 'mal' }] },
          MAX,
        ),
      ).toThrow(INVALID_ACTION);
    });

    it('la referencia antes que los importes, en el mismo ítem', () => {
      expect(() =>
        readReconciliationRequest(
          {
            action: 'PAID',
            items: [{ reservationRef: 'mal', grossAmount: '-1' }],
          },
          MAX,
        ),
      ).toThrow(INVALID_CODE);
    });

    it('los ítems en orden: el primero inválido responde aunque el segundo tenga otro error', () => {
      expect(() =>
        readReconciliationRequest(
          {
            action: 'PAID',
            items: [
              ITEM,
              { ...ITEM, grossAmount: '-1' },
              { ...ITEM, reservationRef: 'mal' },
            ],
          },
          MAX,
        ),
      ).toThrow(INVALID_AMOUNT);
    });
  });
});
