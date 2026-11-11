import { describe, expect, it } from 'vitest';
import {
  readHolderAndNotes,
  readModificationRequest,
} from '../../../../../src/application/use-cases/update-reservation/modification-request.validator.js';
import { BusinessError } from '../../../../../src/domain/shared/business-error.js';

const ROOM_201 = '3f6c1e2a-8b4d-4c7e-9a1f-2b3c4d5e6f70';
const ROOM_305 = '7a2d9c4e-1f3b-4e8a-b6c5-0d9e8f7a6b51';
const UPDATED_AT = '2026-10-08T15:42:10.123456-05:00';

/** Los mensajes literales de la tabla de errores de B del plan (y los de las tablas que reúsa). */
const MESSAGES: Record<string, string> = {
  INVALID_RESERVATION_DATES:
    'La fecha de salida debe ser posterior a la de entrada.',
  INVALID_ROOM_COUNT: 'Una reserva debe tener entre 1 y 10 habitaciones.',
  INVALID_ROOM_ID: 'El identificador de la habitación es inválido.',
  INVALID_GUEST_COUNT:
    'La cantidad de personas debe ser un número entero mayor que cero.',
  NATIONALITY_NOT_EDITABLE: 'La nacionalidad no se puede modificar.',
  GUEST_DATA_REQUIRED: 'Los datos del titular son obligatorios.',
  INVALID_DOCUMENT_TYPE: 'El tipo de documento no es válido.',
  INVALID_CHARACTERS: 'El formato de los datos contiene caracteres no válidos.',
  NOTES_TOO_LONG: 'Las observaciones no pueden superar 500 caracteres.',
  INVALID_EMAIL: 'El correo electrónico no es válido.',
};

/** El titular del ejemplo del cuerpo de cambio del plan (contrato B). */
const HOLDER = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  contactPhone: '+57 300 000 0000',
  contactEmail: 'ana@correo.com',
};

/** El cuerpo de cambio del ejemplo del plan (contrato B). */
const CHANGE = {
  updatedAt: UPDATED_AT,
  startDate: '2026-10-12',
  endDate: '2026-10-15',
  rooms: [
    { roomId: ROOM_201, guestCount: 2 },
    { roomId: ROOM_305, guestCount: 1 },
  ],
  guest: HOLDER,
  notes: 'Llegada tarde',
};

const change = (changes: Record<string, unknown>) => ({
  ...CHANGE,
  ...changes,
});
const withHolder = (changes: Record<string, unknown>) =>
  change({ guest: { ...HOLDER, ...changes } });

/** El error que lanza `read`, que tiene que ser un `BusinessError` (el filtro global lo responde como 400). */
function errorOf(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    return error;
  }
  throw new Error('No lanzó ningún error');
}

const requestError = (body: unknown) =>
  errorOf(() => readModificationRequest(body));
const holderError = (body: unknown) => errorOf(() => readHolderAndNotes(body));

const expected = (errorCode: string) => {
  const message = MESSAGES[errorCode];
  if (message === undefined) {
    throw new Error(`Falta el mensaje de ${errorCode} en la prueba`);
  }
  return expect.objectContaining({ errorCode, message });
};

describe('Validador del cuerpo de cambio (regla 7 de la modificación de update-reservation, T008)', () => {
  describe('readModificationRequest: la forma, antes del paso 1', () => {
    it('lee el cuerpo del ejemplo del plan', () => {
      expect(readModificationRequest(CHANGE)).toEqual({
        expectedUpdatedAt: UPDATED_AT,
        startDate: '2026-10-12',
        endDate: '2026-10-15',
        rooms: [
          { roomId: ROOM_201, guestCount: 2 },
          { roomId: ROOM_305, guestCount: 1 },
        ],
      });
    });

    it('lo que no viene queda en undefined: el dato de la reserva queda como está', () => {
      expect(readModificationRequest({ updatedAt: UPDATED_AT })).toEqual({
        expectedUpdatedAt: UPDATED_AT,
        startDate: undefined,
        endDate: undefined,
        rooms: undefined,
      });
    });

    it.each([
      ['null', null],
      ['una lista', [CHANGE]],
      ['un texto', 'cambio'],
      ['un número', 7],
    ])('un cuerpo que es %s cuenta como {}', (_, body) => {
      expect(readModificationRequest(body)).toEqual({
        expectedUpdatedAt: undefined,
        startDate: undefined,
        endDate: undefined,
        rooms: undefined,
      });
    });

    it.each([
      ['un número', 20261008],
      ['null', null],
      ['un objeto', { at: UPDATED_AT }],
    ])(
      'un updatedAt que es %s no da error aquí: queda undefined y no coincide en el paso 2',
      (_, updatedAt) => {
        expect(
          readModificationRequest(change({ updatedAt })).expectedUpdatedAt,
        ).toBeUndefined();
      },
    );

    it('un updatedAt de texto queda tal cual, aunque no tenga forma de fecha (lo compara el paso 2)', () => {
      expect(
        readModificationRequest(change({ updatedAt: 'ayer' }))
          .expectedUpdatedAt,
      ).toBe('ayer');
    });

    describe('fechas', () => {
      it.each([
        ['startDate', 'null', null],
        ['startDate', 'un número', 20261012],
        ['startDate', 'un objeto', { day: '2026-10-12' }],
        ['endDate', 'null', null],
        ['endDate', 'un número', 20261015],
        ['endDate', 'una lista', ['2026-10-15']],
      ])('%s que es %s: INVALID_RESERVATION_DATES', (field, _, value) => {
        expect(requestError(change({ [field]: value }))).toEqual(
          expected('INVALID_RESERVATION_DATES'),
        );
      });

      it('una fecha de texto pasa tal cual, aunque esté vacía o no exista: la revisa el paso 3', () => {
        expect(
          readModificationRequest(
            change({ startDate: '', endDate: '2026-02-30' }),
          ),
        ).toMatchObject({ startDate: '', endDate: '2026-02-30' });
      });

      it('se puede enviar una sola de las dos fechas', () => {
        expect(
          readModificationRequest({
            updatedAt: UPDATED_AT,
            endDate: '2026-10-16',
          }),
        ).toMatchObject({ startDate: undefined, endDate: '2026-10-16' });
      });
    });

    describe('habitaciones', () => {
      it.each([
        ['null', null],
        ['un objeto', { roomId: ROOM_201, guestCount: 2 }],
        ['un texto', ROOM_201],
      ])('rooms que es %s: INVALID_ROOM_COUNT', (_, rooms) => {
        expect(requestError(change({ rooms }))).toEqual(
          expected('INVALID_ROOM_COUNT'),
        );
      });

      it('la cantidad no se revisa aquí: una lista vacía o de 11 pasa a los pasos 4 y 5', () => {
        const eleven = Array.from({ length: 11 }, () => ({
          roomId: ROOM_201,
          guestCount: 1,
        }));
        expect(readModificationRequest(change({ rooms: [] })).rooms).toEqual(
          [],
        );
        expect(
          readModificationRequest(change({ rooms: eleven })).rooms,
        ).toHaveLength(11);
      });

      it.each([
        ['falta', { guestCount: 2 }],
        ['es null', { roomId: null, guestCount: 2 }],
        ['es un número', { roomId: 201, guestCount: 2 }],
        ['está vacío', { roomId: '', guestCount: 2 }],
        ['no es un UUID', { roomId: 'habitacion-201', guestCount: 2 }],
        ['trae espacios', { roomId: ` ${ROOM_201}`, guestCount: 2 }],
      ])('un roomId que %s: INVALID_ROOM_ID', (_, room) => {
        expect(requestError(change({ rooms: [room] }))).toEqual(
          expected('INVALID_ROOM_ID'),
        );
      });

      it.each([
        ['null', null],
        ['un texto', ROOM_201],
      ])(
        'una habitación que es %s no tiene roomId: INVALID_ROOM_ID',
        (_, room) => {
          expect(requestError(change({ rooms: [room] }))).toEqual(
            expected('INVALID_ROOM_ID'),
          );
        },
      );

      it('el roomId queda en minúsculas, para que el paso 4 vea repetido el mismo UUID', () => {
        expect(
          readModificationRequest(
            change({
              rooms: [
                { roomId: ROOM_201.toUpperCase(), guestCount: 2 },
                { roomId: ROOM_201, guestCount: 1 },
              ],
            }),
          ).rooms,
        ).toEqual([
          { roomId: ROOM_201, guestCount: 2 },
          { roomId: ROOM_201, guestCount: 1 },
        ]);
      });

      it.each([
        ['falta', undefined],
        ['es null', null],
        ['es un texto', '2'],
        ['tiene decimales', 1.5],
        ['es un booleano', true],
      ])('un guestCount que %s: INVALID_GUEST_COUNT', (_, guestCount) => {
        expect(
          requestError(change({ rooms: [{ roomId: ROOM_201, guestCount }] })),
        ).toEqual(expected('INVALID_GUEST_COUNT'));
      });

      it.each([
        ['0', 0],
        ['negativo', -1],
      ])(
        'un guestCount entero %s pasa: lo revisa el paso 5 (GUEST_COUNT_TOO_LOW)',
        (_, guestCount) => {
          expect(
            readModificationRequest(
              change({ rooms: [{ roomId: ROOM_201, guestCount }] }),
            ).rooms,
          ).toEqual([{ roomId: ROOM_201, guestCount }]);
        },
      );

      it('en cada habitación, primero el roomId y después el guestCount', () => {
        expect(
          requestError(change({ rooms: [{ roomId: 'x', guestCount: 'dos' }] })),
        ).toEqual(expected('INVALID_ROOM_ID'));
      });

      it('las habitaciones se revisan en el orden en que llegan', () => {
        expect(
          requestError(
            change({
              rooms: [
                { roomId: ROOM_201, guestCount: 'dos' },
                { roomId: 'x', guestCount: 1 },
              ],
            }),
          ),
        ).toEqual(expected('INVALID_GUEST_COUNT'));
      });
    });

    it('las fechas van antes que las habitaciones, y la entrada antes que la salida', () => {
      expect(requestError(change({ endDate: null, rooms: 'todas' }))).toEqual(
        expected('INVALID_RESERVATION_DATES'),
      );
      expect(requestError(change({ startDate: 1, rooms: 'todas' }))).toEqual(
        expected('INVALID_RESERVATION_DATES'),
      );
    });

    it('no mira el titular ni las observaciones: son del paso 6', () => {
      expect(() =>
        readModificationRequest(
          change({
            guest: { ...HOLDER, nationality: 'Colombia' },
            notes: 'x'.repeat(501),
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('readHolderAndNotes: el paso 6', () => {
    it('lee el titular y las observaciones del ejemplo del plan', () => {
      expect(readHolderAndNotes(CHANGE)).toEqual({
        guest: HOLDER,
        notes: 'Llegada tarde',
      });
    });

    it('sin titular ni observaciones, los dos quedan undefined', () => {
      expect(readHolderAndNotes({ updatedAt: UPDATED_AT })).toEqual({
        guest: undefined,
        notes: undefined,
      });
      expect(readHolderAndNotes(null)).toEqual({
        guest: undefined,
        notes: undefined,
      });
    });

    it('no mira las fechas ni las habitaciones: son de la forma', () => {
      expect(() =>
        readHolderAndNotes(change({ startDate: 1, rooms: 'todas' })),
      ).not.toThrow();
    });

    describe('nacionalidad', () => {
      it.each([
        ['Colombia', 'Colombia'],
        ['vacía', ''],
        ['null', null],
      ])(
        'un titular que trae nationality %s: NATIONALITY_NOT_EDITABLE',
        (_, nationality) => {
          expect(holderError(withHolder({ nationality }))).toEqual(
            expected('NATIONALITY_NOT_EDITABLE'),
          );
        },
      );

      it('va primero: aunque el resto del titular y las observaciones tampoco sirvan', () => {
        expect(
          holderError(
            change({
              guest: { nationality: 'Colombia', firstName: '\u0007' },
              notes: 'x'.repeat(501),
            }),
          ),
        ).toEqual(expected('NATIONALITY_NOT_EDITABLE'));
      });
    });

    describe('titular', () => {
      it('trae todos sus datos: sin los espacios de los extremos, y el teléfono y el correo vacíos quedan en null', () => {
        expect(
          readHolderAndNotes(
            change({
              guest: {
                firstName: '  Ana ',
                lastName: ' Pérez',
                documentType: ' CC ',
                documentNumber: ' 123 ',
                contactPhone: '   ',
                contactEmail: '',
              },
            }),
          ).guest,
        ).toEqual({
          firstName: 'Ana',
          lastName: 'Pérez',
          documentType: 'CC',
          documentNumber: '123',
          contactPhone: null,
          contactEmail: null,
        });
      });

      it('el teléfono y el correo que no vienen o vienen en null quedan en null', () => {
        const { contactPhone: _phone, contactEmail: _email, ...rest } = HOLDER;
        expect(readHolderAndNotes(change({ guest: rest })).guest).toMatchObject(
          { contactPhone: null, contactEmail: null },
        );
        expect(
          readHolderAndNotes(
            withHolder({ contactPhone: null, contactEmail: null }),
          ).guest,
        ).toMatchObject({ contactPhone: null, contactEmail: null });
      });

      it.each([
        ['null', null],
        ['un texto', 'Ana Pérez'],
        ['una lista', [HOLDER]],
      ])(
        'un titular que es %s no trae sus datos: GUEST_DATA_REQUIRED',
        (_, guest) => {
          expect(holderError(change({ guest }))).toEqual(
            expected('GUEST_DATA_REQUIRED'),
          );
        },
      );

      it.each(['firstName', 'lastName', 'documentType', 'documentNumber'])(
        'sin %s, vacío, solo con espacios o en null: GUEST_DATA_REQUIRED',
        (field) => {
          const { [field]: _removed, ...rest } = HOLDER as Record<
            string,
            unknown
          >;
          for (const guest of [
            rest,
            { ...HOLDER, [field]: '' },
            { ...HOLDER, [field]: '   ' },
            { ...HOLDER, [field]: null },
          ]) {
            expect(holderError(change({ guest }))).toEqual(
              expected('GUEST_DATA_REQUIRED'),
            );
          }
        },
      );

      it.each([
        ['que no existe', 'DNI'],
        ['en minúsculas', 'cc'],
        ['que es un número', 1],
      ])(
        'un tipo de documento %s: INVALID_DOCUMENT_TYPE',
        (_, documentType) => {
          expect(holderError(withHolder({ documentType }))).toEqual(
            expected('INVALID_DOCUMENT_TYPE'),
          );
        },
      );

      it('los seis tipos de documento son válidos', () => {
        for (const documentType of ['RC', 'TI', 'CC', 'CE', 'PAS', 'NIT']) {
          expect(
            readHolderAndNotes(withHolder({ documentType })).guest
              ?.documentType,
          ).toBe(documentType);
        }
      });

      it.each([
        ['una barra', '123/45'],
        ['un espacio en medio', '123 45'],
        ['un número en vez de texto', 123],
      ])(
        'un número de documento con %s: INVALID_CHARACTERS',
        (_, documentNumber) => {
          expect(holderError(withHolder({ documentNumber }))).toEqual(
            expected('INVALID_CHARACTERS'),
          );
        },
      );

      it.each([
        ['firstName', 100],
        ['lastName', 100],
        ['documentNumber', 30],
        ['contactPhone', 30],
      ])(
        '%s cabe con %i caracteres y con uno más es INVALID_CHARACTERS',
        (field, limit) => {
          expect(() =>
            readHolderAndNotes(withHolder({ [field]: '1'.repeat(limit) })),
          ).not.toThrow();
          expect(
            holderError(withHolder({ [field]: '1'.repeat(limit + 1) })),
          ).toEqual(expected('INVALID_CHARACTERS'));
        },
      );

      it('el correo cabe con 254 caracteres y con uno más es INVALID_CHARACTERS', () => {
        const email = (length: number) =>
          `${'a'.repeat(length - '@correo.com'.length)}@correo.com`;
        expect(
          readHolderAndNotes(withHolder({ contactEmail: email(254) })).guest
            ?.contactEmail,
        ).toHaveLength(254);
        expect(holderError(withHolder({ contactEmail: email(255) }))).toEqual(
          expected('INVALID_CHARACTERS'),
        );
      });

      it('el largo se cuenta sin los espacios de los extremos', () => {
        expect(
          readHolderAndNotes(withHolder({ firstName: ` ${'a'.repeat(100)} ` }))
            .guest?.firstName,
        ).toHaveLength(100);
      });

      it.each([
        ['firstName', 'Ana\u0007'],
        ['lastName', 'Pé\u0000rez'],
        ['contactPhone', '300\n000'],
        ['contactEmail', 'ana\t@correo.com'],
        ['firstName', 5],
        ['contactPhone', 3000000000],
        ['contactEmail', { email: 'ana@correo.com' }],
      ])('%s con %j: INVALID_CHARACTERS', (field, value) => {
        expect(holderError(withHolder({ [field]: value }))).toEqual(
          expected('INVALID_CHARACTERS'),
        );
      });

      it('las tildes, la ñ y los signos comunes son válidos', () => {
        expect(() =>
          readHolderAndNotes(
            withHolder({
              firstName: 'Ñoño José',
              lastName: "O'Brien-Güell",
              contactPhone: '+57 (300) 000-0000',
            }),
          ),
        ).not.toThrow();
      });

      it('los obligatorios van antes que el tipo de documento, y el tipo antes que los caracteres', () => {
        expect(
          holderError(withHolder({ firstName: '', documentType: 'DNI' })),
        ).toEqual(expected('GUEST_DATA_REQUIRED'));
        expect(
          holderError(
            withHolder({ documentType: 'DNI', lastName: 'Pé\u0000rez' }),
          ),
        ).toEqual(expected('INVALID_DOCUMENT_TYPE'));
      });
    });

    describe('observaciones', () => {
      it.each([
        ['null, que las borra', null, null],
        ['vacías', '', ''],
        [
          'con saltos de línea y tabulaciones',
          'Llegada tarde\n\tpiso 2',
          'Llegada tarde\n\tpiso 2',
        ],
        ['de 500 caracteres', 'x'.repeat(500), 'x'.repeat(500)],
      ])('notes %s se aceptan', (_, notes, read) => {
        expect(readHolderAndNotes(change({ notes })).notes).toBe(read);
      });

      it.each([
        ['un carácter de control', 'Llegada\u0000tarde'],
        ['un retorno de carro', 'Llegada\rtarde'],
        ['un número', 7],
        ['un objeto', { text: 'Llegada tarde' }],
      ])('notes con %s: INVALID_CHARACTERS', (_, notes) => {
        expect(holderError(change({ notes }))).toEqual(
          expected('INVALID_CHARACTERS'),
        );
      });

      it('notes de 501 caracteres: NOTES_TOO_LONG', () => {
        expect(holderError(change({ notes: 'x'.repeat(501) }))).toEqual(
          expected('NOTES_TOO_LONG'),
        );
      });

      it('los caracteres van antes que el largo', () => {
        expect(
          holderError(change({ notes: `${'x'.repeat(501)}\u0007` })),
        ).toEqual(expected('INVALID_CHARACTERS'));
      });

      it('el titular va antes que las observaciones', () => {
        expect(
          holderError(
            change({
              guest: { ...HOLDER, firstName: 'A\u0007' },
              notes: 'x'.repeat(501),
            }),
          ),
        ).toEqual(expected('INVALID_CHARACTERS'));
        expect(
          holderError(
            change({
              guest: { ...HOLDER, lastName: '' },
              notes: 'Llegada\u0000tarde',
            }),
          ),
        ).toEqual(expected('GUEST_DATA_REQUIRED'));
      });
    });

    describe('correo', () => {
      it.each([
        ['sin arroba', 'ana.correo.com'],
        ['sin dominio', 'ana@correo'],
        ['con un espacio', 'ana perez@correo.com'],
        ['con dos arrobas', 'ana@@correo.com'],
      ])('un correo %s: INVALID_EMAIL', (_, contactEmail) => {
        expect(holderError(withHolder({ contactEmail }))).toEqual(
          expected('INVALID_EMAIL'),
        );
      });

      it('va al final: después de las observaciones', () => {
        expect(
          holderError(
            change({
              guest: { ...HOLDER, contactEmail: 'ana@correo' },
              notes: 'x'.repeat(501),
            }),
          ),
        ).toEqual(expected('NOTES_TOO_LONG'));
        expect(
          holderError(
            change({
              guest: { ...HOLDER, contactEmail: 'ana@correo' },
              notes: 'Llegada\u0000tarde',
            }),
          ),
        ).toEqual(expected('INVALID_CHARACTERS'));
      });

      it('sin titular no hay correo que revisar', () => {
        expect(readHolderAndNotes({ notes: 'Llegada tarde' }).guest).toBe(
          undefined,
        );
      });
    });
  });
});
