import { describe, expect, it } from 'vitest';
import {
  readCreationRequest,
  readPreviewRequest,
} from '../../../../../src/application/use-cases/generate-direct-reservation/direct-reservation-request.validator.js';

/** El día operativo del ejemplo del plan (la reserva se crea el 2026-10-09). */
const TODAY = '2026-10-09';
const ROOM_201 = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';
const ROOM_202 = '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51';

/** Los mensajes literales de la tabla C del plan. */
const MESSAGES: Record<string, string> = {
  START_DATE_IN_PAST: 'La fecha de entrada no puede ser anterior a hoy.',
  INVALID_RESERVATION_DATES:
    'La fecha de salida debe ser posterior a la de entrada.',
  INVALID_ROOM_COUNT: 'Una reserva debe tener entre 1 y 10 habitaciones.',
  ROOM_ALREADY_IN_RESERVATION: 'La habitación ya forma parte de la reserva.',
  INVALID_GUEST_COUNT:
    'La cantidad de personas debe ser un número entero mayor que cero.',
  GUEST_COUNT_TOO_LOW: 'Cada habitación debe tener al menos una persona.',
  RATE_CHANGED: 'La tarifa cambió, vuelva a cotizar.',
  NOTES_TOO_LONG: 'Las observaciones no pueden superar 500 caracteres.',
  INVALID_CHARACTERS: 'El formato de los datos contiene caracteres no válidos.',
  GUEST_DATA_REQUIRED: 'Los datos del titular son obligatorios.',
  INVALID_DOCUMENT_TYPE: 'El tipo de documento no es válido.',
  INVALID_EMAIL: 'El correo electrónico no es válido.',
};

/** La solicitud de la vista previa del ejemplo del plan (A). */
const preview = (changes: Record<string, unknown> = {}) => ({
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  categoryRoom: 'DOBLE',
  rooms: [{ guestCount: 2 }, { guestCount: 2 }],
  ...changes,
});

const GUEST = {
  firstName: 'Valentina',
  lastName: 'Ospina',
  documentType: 'CC',
  documentNumber: '1144093552',
  nationality: 'Colombia',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'valentina@correo.com',
};

/** La solicitud de la creación del ejemplo del plan (B). */
const creation = (changes: Record<string, unknown> = {}) => ({
  ...preview(),
  guest: GUEST,
  notes: 'Llegada después de las 8 p. m.',
  expectedRates: [
    { position: 1, lodgingAmount: '750000.00' },
    { position: 2, lodgingAmount: '750000.00' },
  ],
  ...changes,
});

const withGuest = (changes: Record<string, unknown>) =>
  creation({ guest: { ...GUEST, ...changes } });

function errorOf(read: () => unknown) {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('No lanzó ningún error');
}

const previewError = (body: unknown) =>
  errorOf(() => readPreviewRequest(body, TODAY));
const creationError = (body: unknown) =>
  errorOf(() => readCreationRequest(body, TODAY));

const expected = (errorCode: string) =>
  expect.objectContaining(
    MESSAGES[errorCode] === undefined
      ? { errorCode }
      : { errorCode, message: MESSAGES[errorCode] },
  );

describe('Validador de la solicitud de la reserva directa (plan, punto 10)', () => {
  describe('solicitudes válidas', () => {
    it('la vista previa del ejemplo del plan', () => {
      expect(readPreviewRequest(preview(), TODAY)).toEqual({
        startDate: '2026-10-12',
        endDate: '2026-10-15',
        categoryRoom: 'DOBLE',
        rooms: [
          { guestCount: 2, roomId: null },
          { guestCount: 2, roomId: null },
        ],
      });
    });

    it('la creación del ejemplo del plan, con el titular, las observaciones y las tarifas', () => {
      expect(readCreationRequest(creation(), TODAY)).toEqual({
        startDate: '2026-10-12',
        endDate: '2026-10-15',
        categoryRoom: 'DOBLE',
        rooms: [
          { guestCount: 2, roomId: null },
          { guestCount: 2, roomId: null },
        ],
        guest: GUEST,
        notes: 'Llegada después de las 8 p. m.',
        expectedRates: [
          { position: 1, lodgingAmount: '750000.00' },
          { position: 2, lodgingAmount: '750000.00' },
        ],
      });
    });

    it('el roomId es opcional: el que viene se conserva y uno en null no cuenta', () => {
      expect(
        readPreviewRequest(
          preview({
            rooms: [
              { guestCount: 2, roomId: ROOM_201 },
              { guestCount: 1, roomId: null },
            ],
          }),
          TODAY,
        ).rooms,
      ).toEqual([
        { guestCount: 2, roomId: ROOM_201 },
        { guestCount: 1, roomId: null },
      ]);
    });

    it('la vista previa no revisa el titular, las observaciones ni las tarifas', () => {
      expect(() =>
        readPreviewRequest(
          preview({ guest: 'X', notes: 'x'.repeat(501), expectedRates: 'X' }),
          TODAY,
        ),
      ).not.toThrow();
    });
  });

  describe('paso 1: formatos', () => {
    it.each([
      ['ausente', undefined],
      ['en minúscula', 'doble'],
      ['con espacios', 'DOBLE SUPERIOR'],
      ['con tilde', 'ÚNICA'],
      ['que no es texto', 7],
    ])('categoryRoom %s: INVALID_CATEGORY', (_, categoryRoom) => {
      expect(previewError(preview({ categoryRoom }))).toEqual(
        expected('INVALID_CATEGORY'),
      );
    });

    it('un cuerpo que no es un objeto: INVALID_CATEGORY, el primer formato', () => {
      expect(previewError('no es un objeto')).toEqual(
        expected('INVALID_CATEGORY'),
      );
    });

    it.each([
      ['que no es un UUID', '201'],
      ['que no es texto', 201],
    ])('un roomId %s: INVALID_ROOM_ID', (_, roomId) => {
      expect(
        previewError(preview({ rooms: [{ guestCount: 2, roomId }] })),
      ).toEqual(expected('INVALID_ROOM_ID'));
    });

    it('la categoría va antes que el roomId, y los formatos antes que las habitaciones', () => {
      expect(
        previewError(
          preview({ categoryRoom: 'doble', rooms: [{ roomId: '201' }] }),
        ),
      ).toEqual(expected('INVALID_CATEGORY'));
      expect(
        previewError(preview({ rooms: Array(11).fill({ roomId: '201' }) })),
      ).toEqual(expected('INVALID_ROOM_ID'));
    });

    describe('expectedRates (solo en la creación)', () => {
      it('en cualquier orden de posición', () => {
        expect(
          readCreationRequest(
            creation({
              expectedRates: [
                { position: 2, lodgingAmount: '750000.00' },
                { position: 1, lodgingAmount: '520000.50' },
              ],
            }),
            TODAY,
          ).expectedRates,
        ).toEqual([
          { position: 2, lodgingAmount: '750000.00' },
          { position: 1, lodgingAmount: '520000.50' },
        ]);
      });

      it.each([
        ['ausente', undefined],
        ['que no es una lista', { position: 1, lodgingAmount: '750000.00' }],
        [
          'con menos entradas que habitaciones',
          [{ position: 1, lodgingAmount: '750000.00' }],
        ],
        [
          'con una posición 0',
          [
            { position: 0, lodgingAmount: '750000.00' },
            { position: 1, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con una posición mayor que n',
          [
            { position: 1, lodgingAmount: '750000.00' },
            { position: 3, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con una posición repetida',
          [
            { position: 1, lodgingAmount: '750000.00' },
            { position: 1, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con una posición en texto',
          [
            { position: '1', lodgingAmount: '750000.00' },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con una posición decimal',
          [
            { position: 1.5, lodgingAmount: '750000.00' },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con un monto como número',
          [
            { position: 1, lodgingAmount: 750000 },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con un monto sin decimales',
          [
            { position: 1, lodgingAmount: '750000' },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con un monto de un decimal',
          [
            { position: 1, lodgingAmount: '750000.0' },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con un monto en cero',
          [
            { position: 1, lodgingAmount: '0.00' },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
        [
          'con un monto negativo',
          [
            { position: 1, lodgingAmount: '-1.00' },
            { position: 2, lodgingAmount: '750000.00' },
          ],
        ],
      ])('%s: RATE_CHANGED', (_, expectedRates) => {
        expect(creationError(creation({ expectedRates }))).toEqual(
          expected('RATE_CHANGED'),
        );
      });

      it('van antes que las habitaciones y las fechas', () => {
        expect(
          creationError(
            creation({ expectedRates: [], startDate: '2026-02-30' }),
          ),
        ).toEqual(expected('RATE_CHANGED'));
      });

      it('si rooms no es una lista, su cantidad la responde el paso 2', () => {
        expect(
          creationError(
            creation({
              rooms: 'X',
              expectedRates: [{ position: 1, lodgingAmount: '750000.00' }],
            }),
          ),
        ).toEqual(expected('INVALID_ROOM_COUNT'));
      });
    });
  });

  describe('paso 2: habitaciones', () => {
    it('10 habitaciones es el máximo', () => {
      expect(
        readPreviewRequest(
          preview({ rooms: Array(10).fill({ guestCount: 1 }) }),
          TODAY,
        ).rooms,
      ).toHaveLength(10);
    });

    it.each([
      ['ausente', undefined],
      ['que no es una lista', { guestCount: 2 }],
      ['vacía', []],
      ['con 11', Array(11).fill({ guestCount: 1 })],
    ])('rooms %s: INVALID_ROOM_COUNT', (_, rooms) => {
      expect(previewError(preview({ rooms }))).toEqual(
        expected('INVALID_ROOM_COUNT'),
      );
    });

    it('la misma habitación dos veces, aunque cambien las mayúsculas: ROOM_ALREADY_IN_RESERVATION', () => {
      expect(
        previewError(
          preview({
            rooms: [
              { guestCount: 2, roomId: ROOM_201 },
              { guestCount: 2, roomId: ROOM_202 },
              { guestCount: 1, roomId: ROOM_201.toUpperCase() },
            ],
          }),
        ),
      ).toEqual(expected('ROOM_ALREADY_IN_RESERVATION'));
    });

    it('guestCount en 0: GUEST_COUNT_TOO_LOW', () => {
      expect(
        previewError(
          preview({ rooms: [{ guestCount: 2 }, { guestCount: 0 }] }),
        ),
      ).toEqual(expected('GUEST_COUNT_TOO_LOW'));
    });

    it.each([
      ['negativo', -1],
      ['decimal', 1.5],
      ['en texto', '2'],
      ['ausente', undefined],
      ['nulo', null],
    ])('guestCount %s: INVALID_GUEST_COUNT', (_, guestCount) => {
      expect(previewError(preview({ rooms: [{ guestCount }] }))).toEqual(
        expected('INVALID_GUEST_COUNT'),
      );
    });

    it('una habitación que no es un objeto no tiene guestCount: INVALID_GUEST_COUNT', () => {
      expect(previewError(preview({ rooms: ['X'] }))).toEqual(
        expected('INVALID_GUEST_COUNT'),
      );
    });

    it('se revisan en el orden en que llegan', () => {
      expect(
        previewError(
          preview({ rooms: [{ guestCount: -1 }, { guestCount: 0 }] }),
        ),
      ).toEqual(expected('INVALID_GUEST_COUNT'));
    });

    it('la cantidad va antes que la repetida, y la repetida antes que guestCount', () => {
      expect(
        previewError(
          preview({
            rooms: Array(11).fill({ guestCount: 0, roomId: ROOM_201 }),
          }),
        ),
      ).toEqual(expected('INVALID_ROOM_COUNT'));
      expect(
        previewError(
          preview({
            rooms: [
              { guestCount: 0, roomId: ROOM_201 },
              { guestCount: 0, roomId: ROOM_201 },
            ],
          }),
        ),
      ).toEqual(expected('ROOM_ALREADY_IN_RESERVATION'));
    });

    it('las habitaciones van antes que las fechas', () => {
      expect(
        previewError(preview({ rooms: [], startDate: '2026-10-01' })),
      ).toEqual(expected('INVALID_ROOM_COUNT'));
    });
  });

  describe('paso 3: fechas (FR-001a)', () => {
    it('la entrada puede ser hoy', () => {
      expect(
        readPreviewRequest(
          preview({ startDate: TODAY, endDate: '2026-10-10' }),
          TODAY,
        ).startDate,
      ).toBe(TODAY);
    });

    it.each([
      ['sin entrada', { startDate: undefined }],
      ['sin salida', { endDate: undefined }],
      ['con una entrada vacía', { startDate: '' }],
      ['con una fecha que no es texto', { endDate: 20261015 }],
      ['con un día que el mes no tiene', { endDate: '2026-11-31' }],
      ['con la salida igual a la entrada', { endDate: '2026-10-12' }],
      ['con la salida antes de la entrada', { endDate: '2026-10-11' }],
    ])('%s: INVALID_RESERVATION_DATES', (_, dates) => {
      expect(previewError(preview(dates))).toEqual(
        expected('INVALID_RESERVATION_DATES'),
      );
    });

    it('la entrada de ayer: START_DATE_IN_PAST', () => {
      expect(
        previewError(
          preview({ startDate: '2026-10-08', endDate: '2026-10-10' }),
        ),
      ).toEqual(expected('START_DATE_IN_PAST'));
    });

    it('las fechas van antes que las observaciones y el titular', () => {
      expect(
        creationError(
          creation({
            startDate: '2026-10-08',
            notes: 'x'.repeat(501),
            guest: {},
          }),
        ),
      ).toEqual(expected('START_DATE_IN_PAST'));
    });
  });

  describe('paso 4: observaciones', () => {
    it.each([
      ['ausentes', undefined],
      ['en null', null],
    ])('%s quedan en null', (_, notes) => {
      expect(readCreationRequest(creation({ notes }), TODAY).notes).toBeNull();
    });

    it('500 caracteres, con salto de línea y tabulación, se aceptan', () => {
      const notes = `Llegada tarde.\n\t${'x'.repeat(484)}`;
      expect(notes).toHaveLength(500);
      expect(readCreationRequest(creation({ notes }), TODAY).notes).toBe(notes);
    });

    it('501 caracteres: NOTES_TOO_LONG', () => {
      expect(creationError(creation({ notes: 'x'.repeat(501) }))).toEqual(
        expected('NOTES_TOO_LONG'),
      );
    });

    it.each([
      ['un carácter nulo', 'Llegada\u0000tarde'],
      ['un retorno de carro', 'Llegada\rtarde'],
      ['un escape', 'Llegada\u001btarde'],
    ])('con %s: INVALID_CHARACTERS', (_, notes) => {
      expect(creationError(creation({ notes }))).toEqual(
        expected('INVALID_CHARACTERS'),
      );
    });

    it('unas observaciones que no son texto: INVALID_CHARACTERS', () => {
      expect(creationError(creation({ notes: 42 }))).toEqual(
        expected('INVALID_CHARACTERS'),
      );
    });

    it('la longitud va antes que el titular, y el titular antes que los caracteres de las observaciones', () => {
      expect(
        creationError(creation({ notes: 'x'.repeat(501), guest: {} })),
      ).toEqual(expected('NOTES_TOO_LONG'));
      expect(
        creationError(creation({ notes: 'Llegada\u0000tarde', guest: {} })),
      ).toEqual(expected('GUEST_DATA_REQUIRED'));
    });
  });

  describe('paso 4: titular', () => {
    it('se guardan sin los espacios de los extremos, y un teléfono o un correo vacío queda en null', () => {
      expect(
        readCreationRequest(
          withGuest({
            firstName: '  Valentina ',
            documentNumber: ' 1144093552 ',
            contactPhone: '   ',
            contactEmail: '',
          }),
          TODAY,
        ).guest,
      ).toEqual({
        ...GUEST,
        contactPhone: null,
        contactEmail: null,
      });
    });

    it('sin teléfono ni correo', () => {
      const { contactPhone: _phone, contactEmail: _email, ...required } = GUEST;
      expect(
        readCreationRequest(creation({ guest: required }), TODAY).guest,
      ).toEqual({ ...required, contactPhone: null, contactEmail: null });
    });

    it('sin titular: GUEST_DATA_REQUIRED', () => {
      expect(creationError(creation({ guest: undefined }))).toEqual(
        expected('GUEST_DATA_REQUIRED'),
      );
    });

    it.each([
      'firstName',
      'lastName',
      'documentType',
      'documentNumber',
      'nationality',
    ])('sin %s, vacío o solo con espacios: GUEST_DATA_REQUIRED', (field) => {
      for (const value of [undefined, null, '', '   ']) {
        expect(creationError(withGuest({ [field]: value }))).toEqual(
          expected('GUEST_DATA_REQUIRED'),
        );
      }
    });

    it('un tipo de documento fuera de los seis: INVALID_DOCUMENT_TYPE (punto 9)', () => {
      expect(creationError(withGuest({ documentType: 'DNI' }))).toEqual(
        expected('INVALID_DOCUMENT_TYPE'),
      );
    });

    it('un número de documento con un punto: INVALID_CHARACTERS (punto 9)', () => {
      expect(
        creationError(withGuest({ documentNumber: '1.144.093.552' })),
      ).toEqual(expected('INVALID_CHARACTERS'));
    });

    it.each([
      ['un nombre de 101 caracteres', { firstName: 'A'.repeat(101) }],
      ['un apellido de 101 caracteres', { lastName: 'A'.repeat(101) }],
      ['una nacionalidad de 61 caracteres', { nationality: 'A'.repeat(61) }],
      ['un teléfono de 31 caracteres', { contactPhone: '3'.repeat(31) }],
      [
        'un correo de 255 caracteres',
        { contactEmail: `${'a'.repeat(245)}@correo.com` },
      ],
      ['un documento de 31 caracteres', { documentNumber: '1'.repeat(31) }],
      ['un carácter de control en el nombre', { firstName: 'Valen\u0000tina' }],
      ['un salto de línea en el apellido', { lastName: 'Os\npina' }],
      ['un nombre que no es texto', { firstName: 42 }],
      ['un teléfono que no es texto', { contactPhone: 3000000000 }],
    ])('%s: INVALID_CHARACTERS', (_, changes) => {
      expect(creationError(withGuest(changes))).toEqual(
        expected('INVALID_CHARACTERS'),
      );
    });

    it.each([
      ['un nombre de 100', { firstName: 'A'.repeat(100) }],
      ['una nacionalidad de 60', { nationality: 'A'.repeat(60) }],
      ['un teléfono de 30', { contactPhone: '3'.repeat(30) }],
      ['un correo de 254', { contactEmail: `${'a'.repeat(243)}@correo.com` }],
      ['un documento de 30', { documentNumber: '1'.repeat(30) }],
    ])('%s caben en su columna', (_, changes) => {
      expect(() =>
        readCreationRequest(withGuest(changes), TODAY),
      ).not.toThrow();
    });

    it.each([
      ['sin arroba', 'valentina.correo.com'],
      ['sin dominio con punto', 'valentina@correo'],
      ['con un espacio', 'valentina @correo.com'],
      ['con dos arrobas', 'valen@tina@correo.com'],
    ])('un correo %s: INVALID_EMAIL', (_, contactEmail) => {
      expect(creationError(withGuest({ contactEmail }))).toEqual(
        expected('INVALID_EMAIL'),
      );
    });

    it('los datos obligatorios van antes que el documento, y el documento antes que los caracteres', () => {
      expect(
        creationError(withGuest({ firstName: '', documentType: 'DNI' })),
      ).toEqual(expected('GUEST_DATA_REQUIRED'));
      expect(
        creationError(
          withGuest({ documentType: 'DNI', lastName: 'Os\u0000pina' }),
        ),
      ).toEqual(expected('INVALID_DOCUMENT_TYPE'));
    });

    it('los caracteres (del titular o de las observaciones) van antes que el correo', () => {
      expect(
        creationError(
          creation({
            notes: 'Llegada\u0000tarde',
            guest: { ...GUEST, contactEmail: 'no-es-correo' },
          }),
        ),
      ).toEqual(expected('INVALID_CHARACTERS'));
      expect(
        creationError(
          withGuest({
            firstName: 'Valen\u0000tina',
            contactEmail: 'no-es-correo',
          }),
        ),
      ).toEqual(expected('INVALID_CHARACTERS'));
    });
  });
});
