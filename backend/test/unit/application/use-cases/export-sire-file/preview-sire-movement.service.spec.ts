import { describe, expect, it, vi } from 'vitest';
import type { SireConfig } from '../../../../../src/application/ports/out/sire-config.js';
import { PreviewSireMovementService } from '../../../../../src/application/use-cases/export-sire-file/preview-sire-movement.service.js';
import type {
  SelectForeignMovements,
  SireMovement,
} from '../../../../../src/application/use-cases/process-guest-data/ports/in/select-foreign-movements.port.js';

const MOVEMENT_ID = '4b6c1f0e-2d3a-4e5f-8a9b-0c1d2e3f4a5b';

const CONFIG: SireConfig = {
  format: {
    hotelCode: '123456',
    cityCode: '11001',
    fieldSeparator: '\t',
    dateFormat: 'dd/MM/yyyy',
    encoding: 'utf-8',
  },
  lineBreak: '\r\n',
  maxPeriodDays: 366,
  maxRecords: 50000,
};

/** John Smith, del ejemplo del contrato C. */
function john(guest: Partial<SireMovement['guest']> = {}): SireMovement {
  return {
    movementId: MOVEMENT_ID,
    reservationRef: 'RSV-3F9A1C7B',
    movementType: 'ENTRY',
    movementDate: '2026-10-09',
    guest: {
      firstName: 'John',
      lastName: 'Smith',
      documentType: 'PAS',
      documentNumber: 'X99',
      birthDate: '1990-05-12',
      nationality: 'Estados Unidos',
      originPlace: 'Miami, Estados Unidos',
      destinationPlace: 'Cartagena, Colombia',
      ...guest,
    },
  };
}

function serviceWith(movement: SireMovement | null, config = CONFIG) {
  const byMovementId = vi
    .fn<SelectForeignMovements['byMovementId']>()
    .mockResolvedValue(movement);
  return {
    service: new PreviewSireMovementService(
      { byPeriod: vi.fn(), byMovementId },
      config,
    ),
    byMovementId,
  };
}

describe('PreviewSireMovementService (plan de export-sire-file, contrato C y D2)', () => {
  it('escenario 6: devuelve el ejemplo de C, con los 12 campos en orden y la línea sin fin de línea', async () => {
    const { service, byMovementId } = serviceWith(john());

    await expect(service.execute(MOVEMENT_ID)).resolves.toEqual({
      movementId: MOVEMENT_ID,
      reservationRef: 'RSV-3F9A1C7B',
      fields: [
        { position: 1, name: 'Código del hotel', value: '123456' },
        { position: 2, name: 'Código de la ciudad', value: '11001' },
        { position: 3, name: 'Tipo de documento', value: 'PAS' },
        { position: 4, name: 'Número de documento', value: 'X99' },
        { position: 5, name: 'Nacionalidad', value: 'Estados Unidos' },
        { position: 6, name: 'Apellidos', value: 'SMITH' },
        { position: 7, name: 'Nombres', value: 'JOHN' },
        { position: 8, name: 'Tipo de movimiento', value: 'E' },
        { position: 9, name: 'Fecha del movimiento', value: '09/10/2026' },
        {
          position: 10,
          name: 'Lugar de procedencia',
          value: 'Miami, Estados Unidos',
        },
        {
          position: 11,
          name: 'Lugar de destino',
          value: 'Cartagena, Colombia',
        },
        { position: 12, name: 'Fecha de nacimiento', value: '12/05/1990' },
      ],
      line: '123456\t11001\tPAS\tX99\tEstados Unidos\tSMITH\tJOHN\tE\t09/10/2026\tMiami, Estados Unidos\tCartagena, Colombia\t12/05/1990',
    });
    expect(byMovementId).toHaveBeenCalledExactlyOnceWith(MOVEMENT_ID);
  });

  it('usa el formato de la configuración', async () => {
    const { service } = serviceWith(john(), {
      ...CONFIG,
      format: {
        ...CONFIG.format,
        fieldSeparator: '|',
        dateFormat: 'yyyy-MM-dd',
      },
    });

    const { line } = await service.execute(MOVEMENT_ID);

    expect(line).toBe(
      '123456|11001|PAS|X99|Estados Unidos|SMITH|JOHN|E|2026-10-09|Miami, Estados Unidos|Cartagena, Colombia|1990-05-12',
    );
  });

  it('un movimiento que no existe, de un colombiano o con otro formato es MOVEMENT_NOT_FOUND', async () => {
    const { service } = serviceWith(null);

    await expect(service.execute('mov-1')).rejects.toMatchObject({
      errorCode: 'MOVEMENT_NOT_FOUND',
      message: 'El movimiento no existe.',
    });
  });

  it('un dato que no se puede escribir en el archivo es INVALID_GUEST_CHARACTERS', async () => {
    const { service } = serviceWith(john({ lastName: 'Sm\tith' }));

    await expect(service.execute(MOVEMENT_ID)).rejects.toMatchObject({
      errorCode: 'INVALID_GUEST_CHARACTERS',
    });
  });
});
