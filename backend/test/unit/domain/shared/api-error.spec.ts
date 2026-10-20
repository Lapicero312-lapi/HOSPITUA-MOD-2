import {
  ApiError,
  BusinessError,
  NotFoundError,
  TooManyRequestsError,
} from '../../../../src/domain/shared/api-error.js';

describe('ApiError', () => {
  it('responde 400 por defecto', () => {
    const error = new ApiError(
      'INVALID_ROOM_ID',
      'El identificador no es válido',
    );

    expect(error.errorCode).toBe('INVALID_ROOM_ID');
    expect(error.message).toBe('El identificador no es válido');
    expect(error.status).toBe(400);
  });

  it('es un Error y conserva el nombre de su clase', () => {
    const error = new BusinessError('NO_AVAILABILITY', 'Sin disponibilidad');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('BusinessError');
  });

  it('el error de negocio siempre es 400', () => {
    expect(new BusinessError('CODE', 'mensaje').status).toBe(400);
  });

  it('el recurso inexistente es 404 y el exceso de solicitudes es 429', () => {
    expect(new NotFoundError('RESERVATION_NOT_FOUND', 'No existe').status).toBe(
      404,
    );
    expect(
      new TooManyRequestsError('SIRE_RATE_LIMIT', 'Demasiadas').status,
    ).toBe(429);
  });

  it('ningún estado por defecto es 5xx ni 2xx', () => {
    const statuses = [
      new ApiError('A', 'a').status,
      new BusinessError('B', 'b').status,
      new NotFoundError('C', 'c').status,
      new TooManyRequestsError('D', 'd').status,
    ];

    for (const status of statuses) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });
});
