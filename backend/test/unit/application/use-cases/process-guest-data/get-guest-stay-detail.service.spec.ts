import { describe, expect, it, vi } from 'vitest';
import type {
  GuestStayDetailRow,
  GuestStayQuery,
} from '../../../../../src/application/ports/out/guest-stay.query.js';
import { GetGuestStayDetailService } from '../../../../../src/application/use-cases/process-guest-data/get-guest-stay-detail.service.js';

/** John Smith, del ejemplo de C2, con su entrada y su salida. */
function aRow(changes: Partial<GuestStayDetailRow> = {}): GuestStayDetailRow {
  return {
    reservationRef: 'RSV-3F9A1C7B',
    firstName: 'John',
    lastName: 'Smith',
    documentType: 'PAS',
    documentNumber: 'X99',
    birthDate: '1990-05-12',
    nationality: 'Estados Unidos',
    originPlace: 'Miami, Estados Unidos',
    destinationPlace: 'Cartagena, Colombia',
    movements: [
      { movementType: 'ENTRY', movementDate: '2026-10-09' },
      { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
    ],
    ...changes,
  };
}

function serviceWith(row: GuestStayDetailRow | null) {
  const findDetail = vi
    .fn<GuestStayQuery['findDetail']>()
    .mockResolvedValue(row);
  return {
    service: new GetGuestStayDetailService({
      count: vi.fn(),
      findPage: vi.fn(),
      findDetail,
    }),
    findDetail,
  };
}

describe('GetGuestStayDetailService (plan de process-guest-data, C2)', () => {
  it('devuelve el ejemplo de C2: la reserva con su enlace, todos los datos del huésped y sus movimientos', async () => {
    const { service, findDetail } = serviceWith(aRow());

    await expect(service.execute('RSV-3F9A1C7B', 'X99')).resolves.toEqual({
      reservationRef: 'RSV-3F9A1C7B',
      reservationLink: '/api/reservations/RSV-3F9A1C7B',
      guest: {
        documentType: 'PAS',
        documentNumber: 'X99',
        firstName: 'John',
        lastName: 'Smith',
        birthDate: '1990-05-12',
        nationality: 'Estados Unidos',
        isForeign: true,
        originPlace: 'Miami, Estados Unidos',
        destinationPlace: 'Cartagena, Colombia',
      },
      movements: [
        { movementType: 'ENTRY', movementDate: '2026-10-09' },
        { movementType: 'DEPARTURE', movementDate: '2026-10-12' },
      ],
    });
    expect(findDetail).toHaveBeenCalledExactlyOnceWith('RSV-3F9A1C7B', 'X99');
  });

  it('una colombiana sin procedencia ni destino: no es extranjera y lo vacío viaja null', async () => {
    const { service } = serviceWith(
      aRow({
        firstName: 'Ana',
        lastName: 'Pérez',
        documentType: 'CC',
        documentNumber: '123',
        nationality: 'Colombia',
        originPlace: null,
        destinationPlace: '',
      }),
    );

    const { guest } = await service.execute('RSV-3F9A1C7B', '123');

    expect(guest).toMatchObject({
      isForeign: false,
      originPlace: null,
      destinationPlace: null,
    });
  });

  it('una nacionalidad vacía no es extranjera (punto 8)', async () => {
    const { service } = serviceWith(aRow({ nationality: '' }));

    const { guest } = await service.execute('RSV-3F9A1C7B', 'X99');

    expect(guest.isForeign).toBe(false);
  });

  it.each([
    [
      'solo la entrada',
      [{ movementType: 'ENTRY', movementDate: '2026-10-09' }],
    ],
    [
      'solo la salida',
      [{ movementType: 'DEPARTURE', movementDate: '2026-10-12' }],
    ],
  ] as const)('puede traer %s', async (_case, movements) => {
    const { service } = serviceWith(aRow({ movements: [...movements] }));

    await expect(service.execute('RSV-3F9A1C7B', 'X99')).resolves.toMatchObject(
      { movements },
    );
  });

  it.each([
    ['el huésped o la reserva no existen', null],
    ['no tiene movimientos (FR-016)', aRow({ movements: [] })],
  ])('si %s, GUEST_NOT_FOUND', async (_case, row) => {
    const { service } = serviceWith(row);

    await expect(service.execute('RSV-3F9A1C7B', 'X99')).rejects.toMatchObject({
      errorCode: 'GUEST_NOT_FOUND',
      message: 'El huésped no existe en esa reserva.',
    });
  });
});
