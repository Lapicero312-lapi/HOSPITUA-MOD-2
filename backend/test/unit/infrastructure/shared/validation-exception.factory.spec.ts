import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Min,
  ValidateNested,
  validateSync,
} from 'class-validator';
import { ApiError } from '../../../../src/infrastructure/shared/api-error.js';
import { validationExceptionFactory } from '../../../../src/infrastructure/shared/validation-exception.factory.js';

class GuestDto {
  @IsString({
    message: 'El nombre del titular es obligatorio',
    context: { errorCode: 'INVALID_GUEST' },
  })
  firstName!: string;
}

class RequestDto {
  @IsString({
    message: 'La fecha de llegada no es válida',
    context: { errorCode: 'INVALID_STAY_DATES' },
  })
  startDate!: string;

  @IsInt({
    message:
      'La cantidad de personas debe ser un número entero mayor que cero.',
    context: { errorCode: 'INVALID_GUEST_COUNT' },
  })
  @Min(1, {
    message: 'Cada habitación debe tener al menos una persona.',
    context: { errorCode: 'GUEST_COUNT_TOO_LOW' },
  })
  roomCount!: number;

  @IsInt({ message: 'El número de página debe ser 1 o mayor.' })
  page!: number;

  @ValidateNested()
  @Type(() => GuestDto)
  guest!: GuestDto;
}

function errorsOf(plain: object) {
  return validateSync(plainToInstance(RequestDto, plain));
}

const valid = {
  startDate: '2026-10-20',
  roomCount: 1,
  guest: { firstName: 'Ana' },
  page: 1,
};

describe('validationExceptionFactory', () => {
  it('responde 400 con el código del contexto y el mensaje literal del decorador', () => {
    const error = validationExceptionFactory(
      errorsOf({ ...valid, startDate: 20 }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.errorCode).toBe('INVALID_STAY_DATES');
    expect(error.message).toBe('La fecha de llegada no es válida');
  });

  it('usa el primer error en el orden de las propiedades del DTO', () => {
    const error = validationExceptionFactory(
      errorsOf({ startDate: 20, roomCount: 0, guest: {} }),
    );

    expect(error.errorCode).toBe('INVALID_STAY_DATES');
  });

  it('dentro de una propiedad gana el decorador escrito más arriba', () => {
    const error = validationExceptionFactory(
      errorsOf({ ...valid, roomCount: 'abc' }),
    );

    expect(error.errorCode).toBe('INVALID_GUEST_COUNT');
  });

  it('si solo falla el decorador de abajo, responde ese', () => {
    const error = validationExceptionFactory(
      errorsOf({ ...valid, roomCount: 0 }),
    );

    expect(error.errorCode).toBe('GUEST_COUNT_TOO_LOW');
    expect(error.message).toBe(
      'Cada habitación debe tener al menos una persona.',
    );
  });

  it('sin código en el contexto responde INVALID_REQUEST', () => {
    const error = validationExceptionFactory(errorsOf({ ...valid, page: 'x' }));

    expect(error.errorCode).toBe('INVALID_REQUEST');
    expect(error.message).toBe('El número de página debe ser 1 o mayor.');
  });

  it('encuentra el error dentro de un objeto anidado', () => {
    const error = validationExceptionFactory(errorsOf({ ...valid, guest: {} }));

    expect(error.errorCode).toBe('INVALID_GUEST');
    expect(error.message).toBe('El nombre del titular es obligatorio');
  });

  it('sin errores concretos responde un error genérico en español', () => {
    const error = validationExceptionFactory([]);

    expect(error.errorCode).toBe('INVALID_REQUEST');
    expect(error.message).toBe('La solicitud no es válida.');
  });
});
