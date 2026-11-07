import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuestDataRepository } from '../../../../../src/application/ports/out/guest-data.repository.js';
import type { MigratoryMovementRepository } from '../../../../../src/application/ports/out/migratory-movement.repository.js';
import type { ReservationRepository } from '../../../../../src/application/ports/out/reservation.repository.js';
import type { Transaction } from '../../../../../src/application/ports/out/transaction.js';
import type {
  GuestPayload,
  RegisterGuestMovementsCommand,
} from '../../../../../src/application/use-cases/process-guest-data/ports/in/register-guest-movements.port.js';
import { RegisterGuestMovementsService } from '../../../../../src/application/use-cases/process-guest-data/register-guest-movements.service.js';
import type {
  GuestData,
  GuestDataProps,
} from '../../../../../src/domain/migration/guest-data.js';
import type { MigratoryMovementProps } from '../../../../../src/domain/migration/migratory-movement.js';
import { aDirectReservation } from '../../../../support/builders.js';

const TX = { tx: 'la del consumidor' } as unknown as Transaction;
const RESERVATION = aDirectReservation({ reservationRef: 'RSV-8D02E5A4' });
const ROOM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** Ana y John, del mensaje de Check-In del plan de `update-reservation`. Ana no trae procedencia ni destino. */
const ANA: GuestPayload = {
  firstName: 'Ana',
  lastName: 'Pérez',
  documentType: 'CC',
  documentNumber: '123',
  birthDate: '1995-03-20',
  nationality: 'Colombia',
};
const JOHN: GuestPayload = {
  firstName: 'John',
  lastName: 'Smith',
  documentType: 'PAS',
  documentNumber: 'X99',
  birthDate: '1990-05-12',
  nationality: 'Estados Unidos',
  originPlace: 'Miami, Estados Unidos',
  destinationPlace: 'Cartagena, Colombia',
};
const PIERRE: GuestPayload = {
  firstName: 'Pierre',
  lastName: 'Dubois',
  documentType: 'PAS',
  documentNumber: 'FR123456',
  birthDate: '1985-02-03',
  nationality: 'Francia',
  originPlace: 'París, Francia',
  destinationPlace: 'Medellín, Colombia',
};

/** Lo que no puede aparecer en el log (NFR-002 y plan base: sin datos personales). */
const PERSONAL_DATA = [ANA, JOHN, PIERRE].flatMap((guest) => [
  guest.firstName,
  guest.lastName,
  guest.documentNumber,
  guest.birthDate,
]);

function command(
  changes: Partial<RegisterGuestMovementsCommand> = {},
): RegisterGuestMovementsCommand {
  return {
    reservationId: RESERVATION.id,
    roomId: ROOM_ID,
    movementType: 'ENTRY',
    movementDate: '2026-10-09',
    guests: [ANA, JOHN],
    ...changes,
  };
}

/**
 * El servicio con repositorios en memoria que se comportan como los `INSERT … ON CONFLICT DO NOTHING`
 * de la #473: el huésped que ya está en la reserva vuelve como estaba, y el movimiento que ya existe no
 * cuenta.
 */
function serviceWith({ reservationFound = true } = {}) {
  const storedGuests = new Map<string, GuestData>();
  const storedMovements = new Map<string, MigratoryMovementProps>();
  const findById = vi
    .fn<ReservationRepository['findById']>()
    .mockResolvedValue(reservationFound ? RESERVATION : null);
  const insertGuests = vi
    .fn<GuestDataRepository['insertMissing']>()
    .mockImplementation((guests) =>
      Promise.resolve(
        guests.map((guest) => {
          const existing = storedGuests.get(guest.documentNumber);
          if (existing !== undefined) {
            return existing;
          }
          storedGuests.set(guest.documentNumber, guest);
          return guest;
        }),
      ),
    );
  const insertMovements = vi
    .fn<MigratoryMovementRepository['insertMissing']>()
    .mockImplementation((movements) => {
      let created = 0;
      for (const movement of movements) {
        const key = `${movement.guestDataId} ${movement.movementType}`;
        if (!storedMovements.has(key)) {
          storedMovements.set(key, movement.snapshot());
          created += 1;
        }
      }
      return Promise.resolve(created);
    });
  const service = new RegisterGuestMovementsService(
    { findById } as unknown as ReservationRepository,
    { insertMissing: insertGuests },
    {
      insertMissing: insertMovements,
      findWithGuestByPeriod: vi.fn(),
      findWithGuestById: vi.fn(),
    },
  );
  /** Los datos guardados de cada huésped, sin el id que se genera. */
  const guestsStored = () =>
    [...storedGuests.values()].map((guest) => {
      const { id: _id, ...data } = guest.snapshot();
      return data;
    });
  /** Los movimientos guardados, como `documento tipo fecha`. */
  const movementsStored = () =>
    [...storedMovements.values()].map(
      ({ guestDataId, movementType, movementDate }) => {
        const guest = [...storedGuests.values()].find(
          ({ id }) => id === guestDataId,
        );
        return `${guest?.documentNumber} ${movementType} ${movementDate}`;
      },
    );
  return {
    service,
    findById,
    insertGuests,
    insertMovements,
    guestsStored,
    movementsStored,
  };
}

/** Lo que se escribe como advertencia en el log. */
function warnings() {
  return vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
}

/** Los datos de `GuestData` que se esperan de un huésped completo. */
function storedAs(
  guest: GuestPayload,
  changes: Partial<GuestDataProps> = {},
): Omit<GuestDataProps, 'id'> {
  return {
    reservationRef: RESERVATION.reservationRef,
    firstName: guest.firstName as string,
    lastName: guest.lastName as string,
    documentType: guest.documentType as GuestDataProps['documentType'],
    documentNumber: guest.documentNumber as string,
    birthDate: guest.birthDate as string,
    nationality: guest.nationality as string,
    originPlace: guest.originPlace ?? null,
    destinationPlace: guest.destinationPlace ?? null,
    ...changes,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RegisterGuestMovementsService (plan de process-guest-data, B1 y "Reglas de registro")', () => {
  describe('un Check-In', () => {
    it('guarda los datos de cada huésped tal como llegaron, con la reservationRef de la reserva, y un ENTRY con la fecha del mensaje', async () => {
      const { service, findById, guestsStored, movementsStored } =
        serviceWith();

      await service.register(TX, command());

      expect(findById).toHaveBeenCalledExactlyOnceWith(RESERVATION.id, TX);
      // Ana, colombiana, sin procedencia ni destino: quedan `null`.
      expect(guestsStored()).toEqual([storedAs(ANA), storedAs(JOHN)]);
      expect(movementsStored()).toEqual([
        '123 ENTRY 2026-10-09',
        'X99 ENTRY 2026-10-09',
      ]);
    });

    it('escribe los dos INSERT en la transacción de quien llama, en una sola sentencia cada uno', async () => {
      const { service, insertGuests, insertMovements } = serviceWith();

      await service.register(TX, command());

      expect(insertGuests).toHaveBeenCalledOnce();
      expect(insertGuests.mock.calls[0][1]).toBe(TX);
      expect(insertMovements).toHaveBeenCalledOnce();
      expect(insertMovements.mock.calls[0][1]).toBe(TX);
    });

    it('cada movimiento apunta al GuestData guardado de su huésped', async () => {
      const { service, insertGuests, insertMovements } = serviceWith();

      await service.register(TX, command());

      const stored = await insertGuests.mock.results[0].value;
      const movements = insertMovements.mock.calls[0][0];
      expect(movements.map(({ guestDataId }) => guestDataId)).toEqual(
        stored.map(({ id }: GuestData) => id),
      );
      // Cada movimiento con su propio id.
      expect(new Set(movements.map(({ id }) => id)).size).toBe(2);
    });

    it('escenario 2: con tres personas, dos extranjeras, registra tres ENTRY y cuenta dos extranjeros', async () => {
      const { service, movementsStored } = serviceWith();

      await expect(
        service.register(TX, command({ guests: [ANA, JOHN, PIERRE] })),
      ).resolves.toEqual({
        received: 3,
        registered: 3,
        alreadyRegistered: 0,
        foreign: 2,
        skipped: 0,
      });
      expect(movementsStored()).toHaveLength(3);
    });

    it('escenario 4: solo colombianos se registran, y ninguno es extranjero', async () => {
      const { service } = serviceWith();

      await expect(
        service.register(
          TX,
          command({
            guests: [ANA, { ...ANA, documentNumber: '1144093552' }],
          }),
        ),
      ).resolves.toMatchObject({ received: 2, registered: 2, foreign: 0 });
    });

    it('no escribe nada en el log cuando todo está completo', async () => {
      const warn = warnings();
      const { service } = serviceWith();

      await service.register(TX, command({ guests: [ANA, JOHN, PIERRE] }));

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('el Check-Out', () => {
    it('escenarios 3 y 3a: agrega el DEPARTURE al mismo GuestData, sin modificarlo aunque traiga datos distintos, y sin tocar el ENTRY', async () => {
      const warn = warnings();
      const { service, guestsStored, movementsStored } = serviceWith();
      await service.register(TX, command());

      const summary = await service.register(
        TX,
        command({
          movementType: 'DEPARTURE',
          movementDate: '2026-10-12',
          guests: [{ ...ANA, lastName: 'Pérez Gómez' }, JOHN],
        }),
      );

      expect(summary).toEqual({
        received: 2,
        registered: 2,
        alreadyRegistered: 0,
        foreign: 1,
        skipped: 0,
      });
      expect(guestsStored()).toEqual([storedAs(ANA), storedAs(JOHN)]);
      expect(movementsStored()).toEqual([
        '123 ENTRY 2026-10-09',
        'X99 ENTRY 2026-10-09',
        '123 DEPARTURE 2026-10-12',
        'X99 DEPARTURE 2026-10-12',
      ]);
      // Los dos tenían entrada: no hay aviso.
      expect(warn).not.toHaveBeenCalled();
    });

    it('T007: una salida sin entrada crea el GuestData, registra el DEPARTURE y deja un aviso con su lugar en la lista', async () => {
      const warn = warnings();
      const { service, guestsStored, movementsStored } = serviceWith();
      await service.register(TX, command({ guests: [ANA] }));

      const summary = await service.register(
        TX,
        command({
          movementType: 'DEPARTURE',
          movementDate: '2026-10-12',
          guests: [ANA, JOHN],
        }),
      );

      expect(summary).toMatchObject({ registered: 2, alreadyRegistered: 0 });
      expect(guestsStored()).toEqual([storedAs(ANA), storedAs(JOHN)]);
      expect(movementsStored()).toEqual([
        '123 ENTRY 2026-10-09',
        '123 DEPARTURE 2026-10-12',
        'X99 DEPARTURE 2026-10-12',
      ]);
      // Solo John, el segundo de la lista, no tenía entrada.
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Se registró la salida del huésped 2 de la notificación (reserva RSV-8D02E5A4, habitación ${ROOM_ID}) sin una entrada registrada.`,
      );
    });

    it('T007: un ENTRY nuevo no deja el aviso de la salida sin entrada', async () => {
      const warn = warnings();
      const { service } = serviceWith();

      await service.register(TX, command({ guests: [JOHN] }));

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('escenario 5: la notificación repetida', () => {
    it.each(['ENTRY', 'DEPARTURE'] as const)(
      'el mismo %s dos veces no duplica ni cambia nada, y lo cuenta como ya registrado',
      async (movementType) => {
        const warn = warnings();
        const { service, guestsStored, movementsStored } = serviceWith();
        const notification = command({
          movementType,
          guests: [ANA, JOHN, PIERRE],
        });
        await service.register(TX, notification);
        const before = { guests: guestsStored(), movements: movementsStored() };
        warn.mockClear();

        await expect(service.register(TX, notification)).resolves.toEqual({
          received: 3,
          registered: 0,
          alreadyRegistered: 3,
          foreign: 2,
          skipped: 0,
        });
        expect({
          guests: guestsStored(),
          movements: movementsStored(),
        }).toEqual(before);
        // El reenvío de una salida sin entrada no repite el aviso: no registra nada nuevo.
        expect(warn).not.toHaveBeenCalled();
      },
    );

    it('el cambio de habitación: el huésped de otra habitación de la misma reserva sigue con un solo ENTRY', async () => {
      const { service, movementsStored } = serviceWith();
      await service.register(TX, command({ guests: [JOHN] }));

      await expect(
        service.register(
          TX,
          command({
            roomId: '9b2d8f3e-1c4a-4e6b-8f0d-2a3b4c5d6e7f',
            movementDate: '2026-10-10',
            guests: [JOHN, PIERRE],
          }),
        ),
      ).resolves.toMatchObject({ registered: 1, alreadyRegistered: 1 });
      expect(movementsStored()).toEqual([
        'X99 ENTRY 2026-10-09',
        'FR123456 ENTRY 2026-10-10',
      ]);
    });
  });

  describe('regla 2: los repetidos', () => {
    it('el mismo documentNumber dos veces se procesa una vez, con los datos del primero', async () => {
      const { service, insertGuests, guestsStored } = serviceWith();

      const summary = await service.register(
        TX,
        command({
          guests: [JOHN, ANA, { ...JOHN, firstName: 'Johnny' }],
        }),
      );

      expect(summary).toEqual({
        received: 2,
        registered: 2,
        alreadyRegistered: 0,
        foreign: 1,
        skipped: 0,
      });
      expect(insertGuests.mock.calls[0][0]).toHaveLength(2);
      expect(guestsStored()).toEqual([storedAs(JOHN), storedAs(ANA)]);
    });

    it('si el primero está incompleto, se omite y el repetido no lo reemplaza', async () => {
      warnings();
      const { service, guestsStored } = serviceWith();
      const { birthDate: _birthDate, ...withoutBirthDate } = JOHN;

      await expect(
        service.register(TX, command({ guests: [withoutBirthDate, JOHN] })),
      ).resolves.toEqual({
        received: 1,
        registered: 0,
        alreadyRegistered: 0,
        foreign: 1,
        skipped: 1,
      });
      expect(guestsStored()).toEqual([]);
    });

    it('a los que no traen documento no se los junta: cada uno cuenta y se omite por separado', async () => {
      const warn = warnings();
      const { service } = serviceWith();
      const { documentNumber: _a, ...anaWithoutDocument } = ANA;
      const { documentNumber: _b, ...johnWithoutDocument } = JOHN;

      await expect(
        service.register(
          TX,
          command({
            guests: [anaWithoutDocument, johnWithoutDocument, PIERRE],
          }),
        ),
      ).resolves.toEqual({
        received: 3,
        registered: 1,
        alreadyRegistered: 0,
        foreign: 2,
        skipped: 2,
      });
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('regla 3: el huésped al que le falta un dato que la base exige', () => {
    it.each([
      'documentType',
      'documentNumber',
      'firstName',
      'lastName',
      'birthDate',
      'nationality',
    ] as const)(
      'sin %s se omite solo a él, con una alerta sin datos personales, y los demás se registran',
      async (field) => {
        const warn = warnings();
        const { service, guestsStored, movementsStored } = serviceWith();
        const incomplete = { ...PIERRE };
        delete incomplete[field];

        const summary = await service.register(
          TX,
          command({ guests: [ANA, incomplete, JOHN] }),
        );

        expect(summary).toMatchObject({
          received: 3,
          registered: 2,
          skipped: 1,
        });
        expect(guestsStored()).toEqual([storedAs(ANA), storedAs(JOHN)]);
        expect(movementsStored()).toEqual([
          '123 ENTRY 2026-10-09',
          'X99 ENTRY 2026-10-09',
        ]);
        expect(warn).toHaveBeenCalledExactlyOnceWith(
          `Se omitió al huésped 2 de la notificación (reserva RSV-8D02E5A4, habitación ${ROOM_ID}) porque le falta: ${field}.`,
        );
      },
    );

    it('nombra todos los datos que le faltan, y su lugar cuenta en la lista original', async () => {
      const warn = warnings();
      const { service } = serviceWith();

      await service.register(
        TX,
        command({
          guests: [
            JOHN,
            JOHN,
            { documentNumber: 'FR123456', nationality: 'Francia' },
          ],
        }),
      );

      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Se omitió al huésped 3 de la notificación (reserva RSV-8D02E5A4, habitación ${ROOM_ID}) porque le falta: documentType, firstName, lastName, birthDate.`,
      );
    });

    it('la procedencia y el destino no se exigen: el que no los trae se registra con null', async () => {
      const { service, guestsStored } = serviceWith();
      const {
        originPlace: _origin,
        destinationPlace: _destination,
        ...withoutPlaces
      } = JOHN;

      await expect(
        service.register(TX, command({ guests: [withoutPlaces] })),
      ).resolves.toMatchObject({ registered: 1, skipped: 0 });
      expect(guestsStored()).toEqual([
        storedAs(JOHN, { originPlace: null, destinationPlace: null }),
      ]);
    });

    it('un dato vacío no es un dato que falta: se guarda tal cual (FR-004), y una nacionalidad vacía no es extranjera', async () => {
      const { service, guestsStored } = serviceWith();

      await expect(
        service.register(
          TX,
          command({ guests: [{ ...JOHN, nationality: '', originPlace: '' }] }),
        ),
      ).resolves.toEqual({
        received: 1,
        registered: 1,
        alreadyRegistered: 0,
        foreign: 0,
        skipped: 0,
      });
      expect(guestsStored()).toEqual([
        storedAs(JOHN, { nationality: '', originPlace: '' }),
      ]);
    });

    it('si se omite a todos, no registra nada y lo dice en el resumen', async () => {
      warnings();
      const { service, insertGuests, insertMovements } = serviceWith();
      const { nationality: _a, ...anaWithoutNationality } = ANA;
      const { birthDate: _b, ...johnWithoutBirthDate } = JOHN;

      await expect(
        service.register(
          TX,
          command({ guests: [anaWithoutNationality, johnWithoutBirthDate] }),
        ),
      ).resolves.toEqual({
        received: 2,
        registered: 0,
        alreadyRegistered: 0,
        foreign: 1,
        skipped: 2,
      });
      expect(insertGuests).toHaveBeenCalledExactlyOnceWith([], TX);
      expect(insertMovements).toHaveBeenCalledExactlyOnceWith([], TX);
    });
  });

  describe('T007: el RegistrationSummary', () => {
    it('foreign cuenta a los extranjeros entre los recibidos, también al que se omitió', async () => {
      warnings();
      const { service } = serviceWith();
      const { birthDate: _birthDate, ...pierreWithoutBirthDate } = PIERRE;

      await expect(
        service.register(
          TX,
          command({ guests: [ANA, JOHN, pierreWithoutBirthDate] }),
        ),
      ).resolves.toEqual({
        received: 3,
        registered: 2,
        alreadyRegistered: 0,
        foreign: 2,
        skipped: 1,
      });
    });

    it('received es igual a registrados más ya registrados más omitidos', async () => {
      warnings();
      const { service } = serviceWith();
      await service.register(TX, command({ guests: [ANA] }));
      const { firstName: _firstName, ...johnWithoutName } = JOHN;

      const summary = await service.register(
        TX,
        command({ guests: [ANA, johnWithoutName, PIERRE, PIERRE] }),
      );

      expect(summary).toEqual({
        received: 3,
        registered: 1,
        alreadyRegistered: 1,
        foreign: 2,
        skipped: 1,
      });
    });
  });

  it('ningún aviso escribe datos personales (NFR-002)', async () => {
    const warn = warnings();
    const { service } = serviceWith();
    const { birthDate: _birthDate, ...anaWithoutBirthDate } = ANA;

    await service.register(
      TX,
      command({
        movementType: 'DEPARTURE',
        guests: [anaWithoutBirthDate, JOHN, PIERRE],
      }),
    );

    const logged = warn.mock.calls.flat().join('\n');
    expect(warn).toHaveBeenCalledTimes(3);
    for (const value of PERSONAL_DATA) {
      expect(logged).not.toContain(value);
    }
  });

  it('si la reserva no existe, falla sin registrar nada: quien llama ya la había localizado', async () => {
    const { service, insertGuests, insertMovements } = serviceWith({
      reservationFound: false,
    });

    await expect(service.register(TX, command())).rejects.toThrow(
      `La reserva ${RESERVATION.id} no existe.`,
    );
    expect(insertGuests).not.toHaveBeenCalled();
    expect(insertMovements).not.toHaveBeenCalled();
  });
});
